// Small C API around coopiano's instrument engine, for WebAssembly hosts.
// One instance renders stereo audio at the host sample rate, 128 frames at most per call.
#include "../coopiano/instrument.hpp"
#include "../coopiano/piano_host.hpp"
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
    float left[MAX_FRAMES] = {}, right[MAX_FRAMES] = {};
    uint64_t note_sequence = 1;

    explicit Instance(double rate) : engine(instrument::Settings{}), adapter(engine) {
        adapter.prepare(rate, MAX_FRAMES);
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

// MIDI velocity 1..127. Velocity 0 is a note-off. The strike is prepared here,
// on the caller's thread, which takes about a millisecond for each note.
EXPORT int coopiano_note_on(Instance* p, int key, int velocity, int channel) {
    if (key < 0 || key > 127 || channel < 0 || channel > 15) return 0;
    if (velocity <= 0) return p->engine.note_off(key, channel);
    double v = std::clamp(std::min(velocity, 127) / 127.0, 0.02, 1.0);
    uint64_t seed = 0x9e3779b97f4a7c15ULL ^ (p->note_sequence++ * 0x100000001b3ULL) ^ (uint64_t(key) << 32);
    return p->engine.start(p->engine.prepare(key, v, seed), channel);
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
