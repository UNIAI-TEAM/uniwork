# UNI cinematic studio — UNI-1334

Status: in progress. User chose direction 02, architectural studio, on 2026-10-12.

The page is a continuous 3D architectural world. Its native scroll remains the timeline; UNI is an articulated 3D character inside the scene, with a ground, occluding arches, ramps, contact shadow and coherent lighting. Text and conversion controls live in the foreground.

## Motion contract

The opening establishes the full studio and UNI at floor level. Scroll carries a curved run, an anticipation, a ramp jump and landing, a turn around the central arch, a second crossing and a settling close. Camera framing changes along the same path. Body and limb poses are sampled by scroll progress, so reverse scroll restores the same pose. Foot targets stay planted during stance; the pelvis moves above them. Mane and tail respond to stride and turn. Spatial motion freezes when scrolling stops or the user pauses.

## Asset and quality contract

The current repo has no rigged UNI GLB. The first candidate is a source-authored articulated 3D model, with sculpted swept mane/tail, volumetric face/eyes, joint hierarchy and inverse kinematics. It must be visually judged against the approved horse image. A concept render is not evidence of production asset quality. If the authored model cannot meet likeness and finish, the character needs a dedicated model/rig production step; that limitation must remain explicit.

The official shirt mark comes from the shared Logo SVG, never redrawn. The old portrait renderer and edge sprite do not provide the default character motion for this world.

## Runtime budget

One shared WebGL canvas, capped device pixel ratio, bounded shadow/reflection buffers. No continuously running render loop at idle or in a hidden document. The responsive camera keeps the character in the scene rather than shrinking the world to a side sticker. Reduced motion uses an authored still; a static studio image is the no-WebGL fallback. No audio.

## Verification

Validate likeness, weight, foot contact, shadow, depth and foreground legibility together at desktop, phone and the user's viewport. Check run, jump, landing and reverse scroll as a sequence, not isolated position screenshots.


## Runtime review · 2026-10-12

Đã dựng scene thật với skinned limbs, geometry đầu/thân liền, atrium hai tầng, ramp theo route, bóng/reflector và camera theo hành động.
8 e2e tập trung, web typecheck và lint của các file scene đạt. make check không chạy được vì host không có GNU make.
Bản chụp full-page ban đầu không phản ánh canvas fixed; thay bằng 11 viewport native-scroll 0–100%.
Review mỹ thuật vẫn yêu cầu rebuild: model chưa giống UNI/đạt finish điện ảnh và các panel che nhân vật/nhịp hành động.
Bản này là draft reviewable; chưa có quyết định ship. Brief production model/rig và dàn cảnh tiếp nằm ở 2026-10-12-uni-studio-asset-brief.md.