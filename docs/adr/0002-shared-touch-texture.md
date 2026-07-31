# ADR-0002 — One shared touch texture, sampled by every plate

- **Status** Accepted
- **Loop** L1
- **Date** 2026-07-31
- **Spec** §5.3 (which names this ADR explicitly), §1.2 (response), §5.2 (the frame contract)

## Context

Six plates each need to know about the pointer, and each needs something
different from it. Plate I needs a grab point and a release. Plate II needs a
drag angle for the wedge. Plate III needs a repulsor with a soft falloff. Plate
IV needs a sphere collider. Plate V needs a drag axis for the IOR. Plate VI needs
a click position for the shatter impulse.

The obvious implementation is a pointer handler per plate, each maintaining its
own state. It is also wrong in three separate ways.

**It breaks continuity of _feel_.** §1.2 puts response second in the list of
things that produce the studio impression, and the failure mode is subtle: six
independent handlers, each with its own smoothing constant and its own idea of
how long a gesture lingers, make the pointer behave like six different objects.
The visitor cannot articulate what is wrong, but the piece stops feeling like one
material.

**It has no memory, so it cannot express velocity or wake.** A handler that
stores "where is the pointer now" can only ever produce an instantaneous
response. What the plates actually want is _where has the pointer been, how fast,
and how long ago_ — a thread that has been struck keeps ringing, a particle field
that has been swept keeps moving. That is a field over space and time, not a
coordinate.

**It gets sampled wrong on the GPU.** A pointer position handed to a shader as a
uniform is a point; every plate then reinvents a falloff around it, in slightly
different units, and every one of them has to be re-tuned when the viewport
aspect changes.

## Decision

**One 256×256 ping-pong render target holds pointer influence in screen space.
It is written once per frame from pointer events, and every plate samples it.**

Channel layout:

| Channel | Contents                                                                |
| ------- | ----------------------------------------------------------------------- |
| R, G    | pointer velocity in screen space, signed, viewport-fractions per second |
| B       | pressure — 1 while down, decaying when lifted                           |
| A       | age — 1 where the pointer just was, decaying toward 0                   |

Three details that are load-bearing rather than incidental:

**The stamp is a capsule, not a disc.** A pointer moving quickly covers tens of
pixels between frames. Stamping a disc at the current position leaves a dotted
trail; stamping the swept segment between the previous and current position
leaves a continuous stroke at any speed. This is the difference between a thread
that feels grabbed and one that feels tapped. Verified at 27 px/frame — the
trail is unbroken.

**The falloff is smooth and aspect-corrected.** A hard disc edge shows up as a
visible circular boundary in every plate that samples the field, and no amount of
downstream blurring hides it. Aspect correction happens once, here, rather than
six times in six plates.

**Decay is 0.955 per frame.** §5.3 gives the range 0.94–0.97. Tuned by dragging:
at 0.94 a fast stroke has faded before the eye follows it; at 0.97 the trail
outlives the gesture and the field reads as smeared rather than responsive. At
60 fps this is a half-life of ~15 frames, about a quarter of a second.

The field is stepped in the single frame loop **before** anything samples it. A
plate reading the previous frame's field would lag the pointer by 16 ms, which
§1.2 counts as a failure of response.

## Consequences

**Bought:** the pointer behaves like one physical thing across six materials. The
cost is one 256² pass per frame regardless of how many plates are live — it does
not scale with plate count, which is what §5.3 means by "affordable". Every plate
gets velocity and wake for free rather than reimplementing them. Aspect
correction, falloff shape and decay are tuned in one place, so a change is a
change to the whole piece rather than to one sixth of it.

**Paid:** 256×256×RGBA16F is 512 KB of VRAM held for the life of the page, plus a
second target for the ping-pong. Trivial against the GPGPU targets Plate III
needs, but it is permanently resident rather than allocated when a plate becomes
live. The field is also screen-space, so a plate wanting pointer influence in
_world_ space has to unproject — Plate IV's sphere collider does exactly that,
and that conversion belongs to the plate rather than to the field.

**Resolution is 256², not the viewport.** The field is a low-frequency influence
map; a plate samples it with linear filtering and never sees the grid. Matching
the viewport would cost 60× the fill for no visible difference.

## Safari

§7 L5 task 2 warns that "Safari's float texture and `highp` behaviour will break
something in the GPGPU path". This is the first place it can. WebGL2 makes
`RGBA16F` colour-renderable only when `EXT_color_buffer_float` (or
`EXT_color_buffer_half_float`) is present, so the capability is queried rather
than assumed, and the fallback is `UnsignedByteType` with reduced velocity range
— a degraded field rather than a black texture and six dead interactions. Which
path a given browser takes is reported in the L1 debug view. The container this
was built in reports half-float via SwiftShader; real Safari is verified in L5.

## Alternatives rejected

**A pointer handler per plate.** Rejected above, on all three counts.

**A uniform holding position and velocity.** Cheaper, and adequate for a single
effect. It cannot express wake — the field's whole value is that it remembers —
and it pushes falloff and aspect handling into every plate.

**A CPU-side trail buffer uploaded as a texture each frame.** Same expressiveness,
but it uploads a texture per frame from the main thread and does the decay in JS.
The GPU is already the right place for a decay-and-splat over 65k texels.
