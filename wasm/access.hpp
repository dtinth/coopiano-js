// Reads private members of coopiano classes without changes to coopiano's source.
// Explicit template instantiation is exempt from access checks ([temp.explicit]/12 in C++17),
// so Rob<Tag, &Class::member> can store the member pointer in a friend function.
// Use COOPIANO_ROB inside namespace coopiano_access:
//
//   namespace coopiano_access { COOPIANO_ROB(EngineGain, double Engine::*, &Engine::gain_) }
//   engine.*get(coopiano_access::EngineGain{}) = 1.0;
#ifndef COOPIANO_ACCESS_HPP
#define COOPIANO_ACCESS_HPP

namespace coopiano_access {
template <typename Tag, typename Tag::type Member>
struct Rob {
    friend typename Tag::type get(Tag) { return Member; }
};
} // namespace coopiano_access

#define COOPIANO_ROB(Name, Type, Member)                         \
    struct Name {                                                \
        using type = Type;                                       \
        friend type get(Name);                                   \
    };                                                           \
    template struct Rob<Name, Member>;

#endif
