// Moves hammer-contact simulation off the audio thread.
//
// coopiano prepares a strike in two stages:
//   1. piano::ContactResponse: hammer/string contact simulation. Depends only on
//      the key and the velocity. This is 90-99% of the cost (up to ~4.5 ms natively
//      for a soft low bass note).
//   2. piano::StrikeWorkspace::prepare: builds the voice from a ContactResponse and
//      a random seed. About 0.1 ms, no allocation.
// instrument::StrikeBank does stage 1 for all 88 x 127 combinations up front (about
// 15 s and 72 MiB). Here, stage 1 runs in Web Workers on demand instead, and the
// result is sent to the audio thread as a small array of doubles (1-10 KB).
//
// coopiano does not expose these fields, and its source stays unchanged, so this file
// reads them through explicit template instantiation, which is exempt from access
// checks ([temp.explicit]/12 in C++17).
#ifndef COOPIANO_CONTACT_CACHE_HPP
#define COOPIANO_CONTACT_CACHE_HPP
#include "../coopiano/instrument.hpp"
#include <array>
#include <memory>
#include <vector>

namespace contact_cache {
namespace access {
template <typename Tag, typename Tag::type Member>
struct Rob {
    friend typename Tag::type get(Tag) { return Member; }
};
#define COOPIANO_ROB(Name, Type, Member)                         \
    struct Name {                                                \
        using type = Type;                                       \
        friend type get(Name);                                   \
    };                                                           \
    template struct Rob<Name, Member>;

using Doubles3 = std::array<std::vector<double>, 3>;
COOPIANO_ROB(ResponseKey, piano::Key piano::ContactResponse::*, &piano::ContactResponse::key_)
COOPIANO_ROB(ResponseVelocity, double piano::ContactResponse::*, &piano::ContactResponse::velocity_)
COOPIANO_ROB(ResponseContact, piano::detail::ContactResult piano::ContactResponse::*, &piano::ContactResponse::contact_)
COOPIANO_ROB(ResponseForce, Doubles3 piano::ContactResponse::*, &piano::ContactResponse::force_)
COOPIANO_ROB(ResponseQ, Doubles3 piano::ContactResponse::*, &piano::ContactResponse::q_)
COOPIANO_ROB(ResponseQd, Doubles3 piano::ContactResponse::*, &piano::ContactResponse::qd_)
COOPIANO_ROB(EngineStartNote,
             bool (instrument::Engine::*)(const piano::PreparedNote&, int, int) noexcept,
             &instrument::Engine::start_note)
#undef COOPIANO_ROB
} // namespace access

constexpr int FIRST_KEY = 21, LAST_KEY = 108, KEYS = LAST_KEY - FIRST_KEY + 1;
constexpr double FORMAT = 1;

// Same mapping as instrument::StrikeBank with velocity_gamma = 1.
inline double normalized_velocity(int velocity) { return std::clamp(velocity / 127.0, .02, 1.0); }

// Serialized layout (all doubles):
//   FORMAT, key, midi velocity, duration_ms, peak_force, status, string count,
//   then for each string: n_force, n_q, n_qd, force..., q..., qd...
inline void serialize(const piano::ContactResponse& r, int key, int velocity, std::vector<double>& out) {
    const auto& contact = r.*get(access::ResponseContact{});
    const auto& force = r.*get(access::ResponseForce{});
    const auto& q = r.*get(access::ResponseQ{});
    const auto& qd = r.*get(access::ResponseQd{});
    size_t strings = 0;
    while (strings < 3 && !q[strings].empty()) ++strings;
    out.clear();
    out.insert(out.end(), {FORMAT, double(key), double(velocity), contact.duration_ms, contact.peak_force,
                           double(int(contact.status)), double(strings)});
    for (size_t s = 0; s < strings; ++s) {
        out.insert(out.end(), {double(force[s].size()), double(q[s].size()), double(qd[s].size())});
        out.insert(out.end(), force[s].begin(), force[s].end());
        out.insert(out.end(), q[s].begin(), q[s].end());
        out.insert(out.end(), qd[s].begin(), qd[s].end());
    }
}

// Audio-thread side: 88 workspaces plus a table of installed responses.
class Cache {
    std::vector<piano::Key> keys_;
    std::vector<std::unique_ptr<piano::StrikeWorkspace>> workspaces_;
    std::vector<std::unique_ptr<piano::ContactResponse>> responses_; // KEYS * 127
    size_t installed_ = 0;

public:
    Cache(const piano::Voicing& voicing, const piano::Options& options) : responses_(size_t(KEYS) * 127) {
        keys_.reserve(KEYS);
        for (int key = FIRST_KEY; key <= LAST_KEY; ++key) keys_.push_back(piano::make_key(key, voicing));
        for (const auto& key : keys_) workspaces_.push_back(std::make_unique<piano::StrikeWorkspace>(key, options));
    }

    static size_t index(int key, int velocity) { return size_t(key - FIRST_KEY) * 127 + size_t(velocity - 1); }
    static bool valid(int key, int velocity) {
        return key >= FIRST_KEY && key <= LAST_KEY && velocity >= 1 && velocity <= 127;
    }
    bool has(int key, int velocity) const { return valid(key, velocity) && responses_[index(key, velocity)]; }
    size_t installed() const { return installed_; }

    // Rebuilds a ContactResponse from serialized data. The object is first built for
    // the cheapest key (contact takes about 0.01 ms there), then its fields are
    // replaced. It shares string coefficients with this cache's Key, as
    // StrikeWorkspace::prepare requires. Allocates; returns false for malformed data.
    bool install(const double* data, size_t size) {
        if (size < 7 || data[0] != FORMAT) return false;
        int key = int(data[1]), velocity = int(data[2]);
        size_t strings = size_t(data[6]);
        if (!valid(key, velocity) || strings < 1 || strings > 3) return false;
        const piano::Key& k = keys_[size_t(key - FIRST_KEY)];
        if (strings != piano::detail::KeyAccess::strings(k).size()) return false;
        auto r = std::make_unique<piano::ContactResponse>(keys_.back(), 1.0);
        (*r).*get(access::ResponseKey{}) = k;
        (*r).*get(access::ResponseVelocity{}) = normalized_velocity(velocity);
        auto& contact = (*r).*get(access::ResponseContact{});
        contact.duration_ms = data[3];
        contact.peak_force = data[4];
        contact.status = piano::ContactStatus(int(data[5]));
        auto& force = (*r).*get(access::ResponseForce{});
        auto& q = (*r).*get(access::ResponseQ{});
        auto& qd = (*r).*get(access::ResponseQd{});
        size_t at = 7;
        for (size_t s = 0; s < 3; ++s) {
            force[s].clear(), q[s].clear(), qd[s].clear();
            if (s >= strings) continue;
            if (at + 3 > size) return false;
            size_t nf = size_t(data[at]), nq = size_t(data[at + 1]), nqd = size_t(data[at + 2]);
            at += 3;
            if (at + nf + nq + nqd > size) return false;
            if (nq != piano::detail::KeyAccess::strings(k)[s].q.size() || nqd != nq) return false;
            if (s > 0 && nf != force[0].size()) return false;
            force[s].assign(data + at, data + at + nf), at += nf;
            q[s].assign(data + at, data + at + nq), at += nq;
            qd[s].assign(data + at, data + at + nqd), at += nqd;
        }
        if (force[0].empty() || force[0].size() > piano::voice_capacity(k).attack_samples) return false;
        auto& slot = responses_[index(key, velocity)];
        if (!slot) ++installed_;
        slot = std::move(r);
        return true;
    }

    // Stage 2 only. Returns false when the response is not installed yet.
    bool start(instrument::Engine& engine, int midi_key, int velocity, uint64_t seed, int channel) {
        int key = std::clamp(midi_key, FIRST_KEY, LAST_KEY);
        if (!has(key, velocity)) return false;
        auto& workspace = *workspaces_[size_t(key - FIRST_KEY)];
        if (!workspace.prepare(*responses_[index(key, velocity)], seed)) return false;
        return (engine.*get(access::EngineStartNote{}))(workspace.note(), midi_key, channel);
    }
};

// Worker side: computes stage 1 and serializes it.
class Producer {
    std::vector<piano::Key> keys_;
    std::vector<double> out_;

public:
    explicit Producer(const piano::Voicing& voicing) {
        keys_.reserve(KEYS);
        for (int key = FIRST_KEY; key <= LAST_KEY; ++key) keys_.push_back(piano::make_key(key, voicing));
    }
    const std::vector<double>& compute(int key, int velocity) {
        out_.clear();
        if (!Cache::valid(key, velocity)) return out_;
        piano::ContactResponse r(keys_[size_t(key - FIRST_KEY)], normalized_velocity(velocity));
        serialize(r, key, velocity, out_);
        return out_;
    }
    size_t compute_size() const { return out_.size(); }
};
} // namespace contact_cache
#endif
