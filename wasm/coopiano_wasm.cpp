// Small C API around coopiano's instrument engine, for WebAssembly hosts.
// One instance renders stereo audio at the host sample rate, 128 frames at most per call.
#include "../coopiano/instrument.hpp"
#include "../coopiano/piano_host.hpp"
#include "contact_cache.hpp"
#include <algorithm>
#include <cmath>
#include <memory>
#include <new>

#define EXPORT extern "C" __attribute__((used, visibility("default")))

namespace {
constexpr size_t MAX_FRAMES = 128;

struct Instance {
    instrument::Engine engine;
    piano_host::Adapter adapter;
    contact_cache::Cache cache;
    std::vector<double> install_buffer;
    float left[MAX_FRAMES] = {}, right[MAX_FRAMES] = {};
    uint64_t note_sequence = 1;

    explicit Instance(double rate)
        : engine(instrument::Settings{}), adapter(engine),
          cache(engine.settings().voicing, engine.settings().voice_options) {
        adapter.prepare(rate, MAX_FRAMES);
    }
    uint64_t next_seed(int key) {
        return 0x9e3779b97f4a7c15ULL ^ (note_sequence++ * 0x100000001b3ULL) ^ (uint64_t(key) << 32);
    }
};
} // namespace

// Returns null when the sample rate is not supported (44.1, 48, 88.2 or 96 kHz).
EXPORT Instance* coopiano_create(double sample_rate) {
    if (!piano_host::supported_rate(sample_rate)) return nullptr;
    return new (std::nothrow) Instance(sample_rate);
}

EXPORT void coopiano_destroy(Instance* p) { delete p; }
EXPORT float* coopiano_left(Instance* p) { return p->left; }
EXPORT float* coopiano_right(Instance* p) { return p->right; }
EXPORT unsigned coopiano_latency(Instance* p) { return unsigned(p->adapter.latency_samples()); }

// MIDI velocity 1..127. Velocity 0 is a note-off. The whole strike, including the
// contact simulation, is prepared here on the caller's thread: 0.05-5 ms for each note.
EXPORT int coopiano_note_on(Instance* p, int key, int velocity, int channel) {
    if (key < 0 || key > 127 || channel < 0 || channel > 15) return 0;
    if (velocity <= 0) return p->engine.note_off(key, channel);
    velocity = std::min(velocity, 127);
    return p->engine.start(p->engine.prepare(key, contact_cache::normalized_velocity(velocity), p->next_seed(key)),
                           channel);
}

// Like coopiano_note_on, but uses an installed contact response (about 0.1 ms).
// Returns 1 when started, 0 when the response for this key/velocity is not installed
// yet (see coopiano_contact_key), and -1 for invalid input.
EXPORT int coopiano_note_on_cached(Instance* p, int key, int velocity, int channel) {
    if (key < 0 || key > 127 || channel < 0 || channel > 15 || velocity < 1 || velocity > 127) return -1;
    int physical = std::clamp(key, contact_cache::FIRST_KEY, contact_cache::LAST_KEY);
    if (!p->cache.has(physical, velocity)) return 0;
    return p->cache.start(p->engine, key, velocity, p->next_seed(key), channel) ? 1 : -1;
}

// The physical key (21..108) whose contact response a MIDI key uses.
EXPORT int coopiano_contact_key(int key) {
    return std::clamp(key, contact_cache::FIRST_KEY, contact_cache::LAST_KEY);
}
EXPORT int coopiano_has_contact(Instance* p, int key, int velocity) { return p->cache.has(key, velocity); }
EXPORT unsigned coopiano_contact_count(Instance* p) { return unsigned(p->cache.installed()); }

// Installing a serialized contact response: write `count` doubles to the returned
// buffer, then call coopiano_install_contact.
EXPORT double* coopiano_install_buffer(Instance* p, unsigned count) {
    p->install_buffer.resize(count);
    return p->install_buffer.data();
}
EXPORT int coopiano_install_contact(Instance* p) {
    return p->cache.install(p->install_buffer.data(), p->install_buffer.size());
}

// Worker side. A producer computes serialized contact responses; it needs no engine.
EXPORT contact_cache::Producer* coopiano_producer_create() {
    return new (std::nothrow) contact_cache::Producer(instrument::Settings{}.voicing);
}
EXPORT const double* coopiano_produce(contact_cache::Producer* q, int key, int velocity) {
    return q->compute(key, velocity).data();
}
EXPORT unsigned coopiano_produce_size(contact_cache::Producer* q) {
    return unsigned(q->compute_size());
}

EXPORT int coopiano_note_off(Instance* p, int key, int channel) {
    if (key < 0 || key > 127 || channel < 0 || channel > 15) return 0;
    return p->engine.note_off(key, channel);
}

// position: 0 (up) .. 1 (down), for example CC64 / 127.
EXPORT int coopiano_pedal(Instance* p, int channel, double position) {
    if (channel < 0 || channel > 15) return 0;
    return p->engine.pedal(channel, std::clamp(position, 0.0, 1.0));
}

// Silences all voices and effect tails at once.
EXPORT void coopiano_reset(Instance* p) { p->adapter.reset(); }

// Renders `frames` (at most 128) into the left and right buffers.
EXPORT int coopiano_process(Instance* p, int frames) {
    if (frames < 0 || size_t(frames) > MAX_FRAMES) return 0;
    return p->adapter.process(p->left, p->right, size_t(frames));
}
