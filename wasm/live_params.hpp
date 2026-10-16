// Settings that can change while the engine plays. coopiano fixes its settings when
// the Engine is constructed. The output gain and the room reverb are applied after
// all voices, and they do not need a new Engine: this file changes them in place,
// with no allocation, from the audio thread.
//
// Other settings (hammer, strings, soundboard, ...) change the strike data and the
// soundboard impulse responses, so they need a new Engine and new contact responses.
#ifndef COOPIANO_LIVE_PARAMS_HPP
#define COOPIANO_LIVE_PARAMS_HPP
#include "../coopiano/instrument.hpp"
#include "access.hpp"
#include <algorithm>
#include <cmath>

namespace coopiano_access {
COOPIANO_ROB(EngineSettings, instrument::Settings instrument::Engine::*, &instrument::Engine::settings_)
COOPIANO_ROB(EngineEffects, instrument::OutputEffects instrument::Engine::*, &instrument::Engine::effects_)
using ReverbLines = std::array<double, 8>;
COOPIANO_ROB(ReverbOptions, room::Options room::StereoReverb::*, &room::StereoReverb::options_)
COOPIANO_ROB(ReverbFeedback, ReverbLines room::StereoReverb::*, &room::StereoReverb::feedback_)
COOPIANO_ROB(ReverbLowpass, double room::StereoReverb::*, &room::StereoReverb::lowpass_)
} // namespace coopiano_access

namespace live_params {

// volume_db: added to coopiano's default output gain. The output limiter comes after it.
inline void set_volume(instrument::Engine& engine, double volume_db) {
    if (!std::isfinite(volume_db)) return;
    (engine.*get(coopiano_access::EngineSettings{})).gain =
        instrument::Settings{}.gain * std::pow(10.0, std::clamp(volume_db, -60.0, 12.0) / 20);
}

// The same ranges and formulas as room::StereoReverb. The reverb always runs at
// piano::FS. Its delay lines exist only when it was built with mix > 0.
inline void set_reverb(instrument::Engine& engine, double mix, double decay_seconds, double damping_hz) {
    if (!std::isfinite(mix) || !std::isfinite(decay_seconds) || !std::isfinite(damping_hz)) return;
    auto& reverb = (engine.*get(coopiano_access::EngineEffects{})).reverb;
    auto& options = reverb.*get(coopiano_access::ReverbOptions{});
    if (instrument::Settings{}.reverb.mix == 0) return;
    mix = std::clamp(mix, 0.0, 1.0);
    decay_seconds = std::clamp(decay_seconds, 0.2, 4.0);
    damping_hz = std::clamp(damping_hz, 500.0, 12000.0);
    // When the reverb is off, it keeps its old state. Clear it before it is on again.
    if (options.mix == 0 && mix != 0) reverb.reset();
    options.mix = mix;
    if (options.decay_seconds != decay_seconds) {
        options.decay_seconds = decay_seconds;
        constexpr int lengths[] = {1493, 1601, 1747, 1867, 1999, 2131, 2281, 2423};
        auto& feedback = reverb.*get(coopiano_access::ReverbFeedback{});
        for (size_t i = 0; i < feedback.size(); ++i)
            feedback[i] = std::pow(10.0, -3.0 * lengths[i] / (piano::FS * decay_seconds));
    }
    if (options.damping_hz != damping_hz) {
        options.damping_hz = damping_hz;
        reverb.*get(coopiano_access::ReverbLowpass{}) = std::exp(-2 * 3.14159265358979323846 * damping_hz / piano::FS);
    }
}
} // namespace live_params
#endif
