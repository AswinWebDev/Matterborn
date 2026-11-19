"""Build the hackathon project report (16:9 slide-style PDF) from the game's captures.

    python3 docs/report/make_report.py "Team Name"

Writes docs/report/<Team Name> + Matterborn.pdf. Images come from capture/ (report_*, gallery_*,
shot_* stills made with the dev capture tools) and docs/media/hero_concept.jpg (the Lux3D concept).
"""

import os
import sys
from PIL import Image
from reportlab.lib.colors import HexColor, Color
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CAP = os.path.join(ROOT, 'capture')
TMP = os.path.join(ROOT, 'docs', 'report', 'img')
W, H = 960, 540

BG = HexColor('#0f1118')
INK = HexColor('#f6eadb')
DIM = HexColor('#b9ad9f')
AMBER = HexColor('#ffb260')
CYAN = HexColor('#8ff0ff')
PANEL = HexColor('#1a1d27')

team = sys.argv[1] if len(sys.argv) > 1 else 'TEAM NAME'
AUTHOR = 'Aswin Vinod'
PLAY_LINK = sys.argv[2] if len(sys.argv) > 2 else '<deployed link>'
VIDEO_LINK = sys.argv[3] if len(sys.argv) > 3 else '<trailer link>'
os.makedirs(TMP, exist_ok=True)


def img(path, max_w=1600):
    """Downscale to a JPEG (keeps the PDF small) and return a reader."""
    src = path if os.path.isabs(path) else os.path.join(CAP, path)
    if not os.path.exists(src):
        return None
    out = os.path.join(TMP, os.path.splitext(os.path.basename(src))[0] + '.jpg')
    if not os.path.exists(out) or os.path.getmtime(out) < os.path.getmtime(src):
        im = Image.open(src).convert('RGB')
        if im.width > max_w:
            im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
        im.save(out, 'JPEG', quality=86)
    return ImageReader(out)


c = canvas.Canvas(os.path.join(ROOT, 'docs', 'report', f'{team} + Matterborn.pdf'), pagesize=(W, H))
c.setTitle(f'{team} + Matterborn')
c.setAuthor(f'{team} ({AUTHOR})')
c.setSubject('Manycore Aholo Global 3D AI Hackathon project report')


def page_bg():
    c.setFillColor(BG)
    c.rect(0, 0, W, H, stroke=0, fill=1)


def title(t, sub=None, y=H - 58):
    c.setFillColor(INK)
    c.setFont('Helvetica-Bold', 26)
    c.drawString(40, y, t)
    if sub:
        c.setFillColor(AMBER)
        c.setFont('Helvetica', 12.5)
        c.drawString(40, y - 22, sub)


def text(lines, x, y, size=11.5, color=INK, lead=1.45, font='Helvetica', width=None):
    c.setFont(font, size)
    c.setFillColor(color)
    for ln in lines:
        if width:
            # simple word wrap
            words = ln.split(' ')
            cur = ''
            for w in words:
                nxt = (cur + ' ' + w).strip()
                if c.stringWidth(nxt, font, size) > width and cur:
                    c.drawString(x, y, cur)
                    y -= size * lead
                    cur = w
                else:
                    cur = nxt
            if cur:
                c.drawString(x, y, cur)
                y -= size * lead
        else:
            c.drawString(x, y, ln)
            y -= size * lead
    return y


def picture(reader, x, y, w, h, label=None, border=None):
    if reader is None:
        c.setFillColor(PANEL)
        c.rect(x, y, w, h, stroke=0, fill=1)
        return
    iw, ih = reader.getSize()
    # cover-fit crop
    s = max(w / iw, h / ih)
    dw, dh = iw * s, ih * s
    c.saveState()
    p = c.beginPath()
    p.roundRect(x, y, w, h, 6)
    c.clipPath(p, stroke=0, fill=0)
    c.drawImage(reader, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
    c.restoreState()
    if border:
        c.setStrokeColor(border)
        c.setLineWidth(1.2)
        c.roundRect(x, y, w, h, 6, stroke=1, fill=0)
    if label:
        c.setFillColor(Color(0, 0, 0, alpha=0.55))
        c.roundRect(x + 6, y + 6, c.stringWidth(label, 'Helvetica-Bold', 9.5) + 12, 17, 4, stroke=0, fill=1)
        c.setFillColor(INK)
        c.setFont('Helvetica-Bold', 9.5)
        c.drawString(x + 12, y + 11, label)


def footer(n):
    c.setFillColor(DIM)
    c.setFont('Helvetica', 8.5)
    c.drawString(40, 18, f'{team} + Matterborn  ·  Manycore Aholo Global 3D AI Hackathon  ·  #Manycorehackathon')
    c.drawRightString(W - 40, 18, str(n))


# ------------------------------------------------------------------ 1. cover
cover = img('report_cover.png')
if cover:
    iw, ih = cover.getSize()
    s = max(W / iw, H / ih)
    c.drawImage(cover, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s)
c.setFillColor(Color(0.04, 0.05, 0.08, alpha=0.55))
c.rect(0, 0, W, 170, stroke=0, fill=1)
c.setFillColor(INK)
c.setFont('Helvetica-Bold', 46)
c.drawString(40, 100, 'MATTERBORN')
c.setFillColor(AMBER)
c.setFont('Helvetica', 16)
c.drawString(42, 74, 'Become what the world needs')
c.setFillColor(INK)
c.setFont('Helvetica', 12)
c.drawString(42, 48, f'{team} ({AUTHOR}, solo)  ·  a 3D puzzle-platformer built with Aholo Lux3D and Aholo World')
c.drawString(42, 30, 'Manycore Aholo Global 3D AI Hackathon  ·  Play in 3D, Create with Aholo')
c.showPage()

# ------------------------------------------------------------------ 2. the idea
page_bg()
title('The idea', 'A clay golem that changes what things are made of, including itself')
y = text([
    'The Makers vanished and everything they made faded back into clay. You are Loam, the last golem.',
    'Loam can become Clay, Stone, Wood or Glass, and each material changes how the world answers:',
], 40, H - 118, width=560)
rows = [
    ('Clay', 'light and nimble: double jump, wall jump. Water melts it.'),
    ('Stone', 'heavy: pound through cracked floors, charge through walls, shove stone blocks, sink, hold plates.'),
    ('Wood', 'leaps high and floats on water, but fire burns it.'),
    ('Glass', 'light passes straight through, but a hard landing shatters it.'),
]
for k, v in rows:
    c.setFillColor(AMBER)
    c.setFont('Helvetica-Bold', 12)
    c.drawString(52, y, k)
    y = text([v], 104, y, size=11.5, width=480)
y -= 6
y = text([
    'Press E to pass your material on to a block: a stone block turned to glass lets a beam of light reach a sealed door.',
    'Every altar restores one kind of matter to the world with a sweeping wave of colour, and the journey ends in an '
    'escape from a waking colossus into a valley that has remembered what it was made of.',
], 40, y, width=560)
forms = ['report_form_clay.png', 'report_form_stone.png', 'report_form_wood.png', 'report_form_glass.png']
labels = ['Clay', 'Stone (Lux3D material transfer)', 'Wood (Lux3D material transfer)', 'Glass (shader)']
for i, (f, lb) in enumerate(zip(forms, labels)):
    picture(img(f), 620 + (i % 2) * 165, 300 - (i // 2) * 172, 158, 165, lb)
footer(2)
c.showPage()

# ------------------------------------------------------------------ 3. the Aholo pipeline
page_bg()
title('How Aholo builds the game', 'Lux3D is the production pipeline, not a prop shop: 34 generation jobs, every one used in game')


def box(x, y, w, h, head, body, col=AMBER):
    c.setFillColor(PANEL)
    c.roundRect(x, y, w, h, 8, stroke=0, fill=1)
    c.setStrokeColor(col)
    c.setLineWidth(1.2)
    c.roundRect(x, y, w, h, 8, stroke=1, fill=0)
    c.setFillColor(col)
    c.setFont('Helvetica-Bold', 11)
    c.drawString(x + 10, y + h - 18, head)
    text(body, x + 10, y + h - 34, size=9.4, color=INK, lead=1.35, width=w - 18)


def arrow(x1, y1, x2, y2):
    c.setStrokeColor(DIM)
    c.setLineWidth(1.4)
    c.line(x1, y1, x2, y2)
    import math
    a = math.atan2(y2 - y1, x2 - x1)
    for s in (-0.45, 0.45):
        c.line(x2, y2, x2 - 8 * math.cos(a + s), y2 - 8 * math.sin(a + s))


bw, bh = 196, 92
yA = H - 210
box(40, yA, bw, bh, '1  Lux3D image', ['Concept art of Loam from a prompt (A-pose, glowing heart, simple face).'])
box(272, yA, bw, bh, '2  Lux3D image → 3D (G1)', ['The hero mesh with PBR textures, 54k triangles.'])
box(504, yA, bw, bh, '3  Humanoid auto-rig', ['52-joint skeleton bound to the generated mesh.'])
box(736, yA, bw - 12, bh, '4  Animation retarget', ['30 preset motions: run, jump, swim, push, climb, cast, sit, wake…'])
for x in (236, 468, 700):
    arrow(x + 2, yA + bh / 2, x + 34, yA + bh / 2)
yB = yA - 118
box(40, yB, bw, bh, '5  Material transfer', ['Lux3D stone & wood swatches → Loam\'s Stone and Wood forms and the wooden block.'], CYAN)
box(272, yB, bw, bh, '6  Text → 3D (G1-Turbo)', ['14 props, the colossus, the lantern moth, puzzle block and cracked slab.'], CYAN)
box(504, yB, bw, bh, '7  Part split + articulation', ['Slab → debris pieces. Colossus and moth → URDF joints that swing in game.'], CYAN)
box(736, yB, bw - 12, bh, '8  Aholo World', ['"Valley of Makers" Gaussian splats (Spark) + sky panoramas.'], CYAN)
text([
    'pipeline/gen.mjs (official @manycore/aholo-sdk-lux3d) validates every request against the Lux3D contract before '
    'spending credits, resumes tasks instead of paying twice, and pipeline/process.mjs optimises everything for the web '
    '(meshopt geometry, WebP textures, rig-checked animation clips, URDF → joint descriptors): 4–8x smaller files.',
], 40, yB - 30, size=10.5, color=DIM, width=880)
footer(3)
c.showPage()

# ------------------------------------------------------------------ 4. asset gallery
page_bg()
title('Generated with Lux3D', 'Every model in the game, rendered from the shipped files · browse them in game: press G on the title screen')
ids = ['hero_model', 'hero_stone', 'hero_wood', 'obj_block', 'obj_block_wood', 'obj_crack_slab', 'obj_crack_slab_parts', 'cr_colossus',
       'cr_moth', 'env_kiln', 'env_workbench', 'env_statue', 'env_pillar', 'env_arch', 'env_wall', 'env_crate', 'env_emitter', 'env_lantern',
       'env_tree', 'env_rocks', 'env_mushrooms', 'env_gear', 'env_scaffold']
names = ['Loam (image→3D)', 'Loam · stone', 'Loam · wood', 'Block', 'Block · wood', 'Cracked slab', 'Slab part split', 'Colossus', 'Lantern moth',
         'Kiln', 'Workbench', 'Statue', 'Pillar', 'Arch', 'Ruined wall', 'Crate', 'Crystal emitter', 'Lantern', 'Ancient tree', 'Rocks',
         'Glow mushrooms', 'Gear', 'Scaffold']
cols, sz, gap = 8, 104, 8
x0 = (W - (cols * sz + (cols - 1) * gap)) / 2
for i, (iid, nm) in enumerate(zip(ids, names)):
    x = x0 + (i % cols) * (sz + gap)
    y = H - 110 - sz - (i // cols) * (sz + 24)
    picture(img(f'gallery_{iid}.png', 480), x, y, sz, sz)
    c.setFillColor(DIM)
    c.setFont('Helvetica', 8.2)
    c.drawCentredString(x + sz / 2, y - 11, nm)
footer(4)
c.showPage()

# ------------------------------------------------------------------ 5. hero chain
page_bg()
title('Loam, from a sentence to a playable hero', 'image → 3D → rig → retarget → material transfer, all Lux3D')
chain = [
    (os.path.join(ROOT, 'docs', 'media', 'hero_concept.jpg'), 'Lux3D concept image'),
    ('gallery_hero_model.png', 'Lux3D image → 3D'),
    ('report_form_clay.png', 'Rigged + 30 clips, in game'),
    ('report_form_stone.png', 'Material transfer: stone'),
]
for i, (f, lb) in enumerate(chain):
    x = 40 + i * 225
    picture(img(f), x, 170, 205, 260, lb)
    if i < 3:
        arrow(x + 207, 300, x + 222, 300)
text([
    'The retargeted clips are blended live (cross-fades, speed matched to movement) and layered with procedural squash and '
    'stretch, lean and flips. Lux3D material transfer turns the same mesh into the Stone and Wood forms, so switching '
    'material in game swaps the generated textures on the rigged hero. Glass is a fresnel shader (the handbook flags '
    'transparent materials as unstable in Lux3D).',
], 40, 140, size=11, color=INK, width=880)
footer(5)
c.showPage()

# ------------------------------------------------------------------ 6. the world
page_bg()
title('A world that remembers', 'Six areas, each with its own light: dusk, moonlight, mist, silver beams, fire and sunrise')
shots = [('report_atelier.png', 'The Atelier: volumetric light through high windows'), ('report_court.png', 'Stone court: Maker sigil, block puzzle'),
         ('report_lake.png', 'Aqueduct: sink as stone, float as wood'), ('report_hall.png', 'Hall of light: imprint glass, guide the beam'),
         ('report_fire.png', 'Fire trough: wood burns'), ('report_valley_tree.png', 'The valley, alive again')]
for i, (f, lb) in enumerate(shots):
    x = 40 + (i % 3) * 296
    y = H - 120 - 160 - (i // 3) * 182
    picture(img(f), x, y, 284, 160, lb)
footer(6)
c.showPage()

# ------------------------------------------------------------------ 7. iteration
page_bg()
title('Iteration', 'From procedural stand-ins to generated assets, and the fixes along the way')
pairs = [
    ('shot_pound_01.png', 'Day 1: procedural stand-in golem', 'report_form_clay.png', 'Final: Lux3D hero, rigged and lit'),
    ('hero_closeup_front.png', 'Bug: black patches on the hero', 'report_form_wood.png', 'Fixed: pooled lights + clamps'),
    ('report_aq_before.png', 'World faded to clay', 'report_aq_after.png', 'Restored by the wood altar'),
]
for i, (a, la, b, lb) in enumerate(pairs):
    y = H - 120 - 120 - i * 128
    picture(img(a), 40, y, 210, 118, la)
    arrow(256, y + 59, 284, y + 59)
    picture(img(b), 290, y, 210, 118, lb)
yy = text(['What changed overnight, and after playtests'], 530, H - 128, size=12, color=AMBER, font='Helvetica-Bold')
for item in [
    'Rendering rebuilt around the generated assets: N8AO, volumetric sunlight, height fog, area moods, image-based lighting, depth of field; 8 pooled lights and adaptive quality keep 60 fps.',
    'Articulation used for real: the colossus swings its URDF shoulder, the moths flap on their wing hinges; Aholo World splats behind the final valley.',
    'Playtest fixes: an authored camera per area (no free look), no climbing over puzzles (wall-jump rule, capped walls), solid props, a lake respawn bug.',
    'Longer and deeper: two blocks for two plates, two blocks in the beam, and the Maker\'s Trial, a room that asks for every form in turn.',
    'Fully voiced: an ElevenLabs narrator, Loam\'s little voice, ~50 effects, ambience and score, ducked and mixed live in Web Audio.',
]:
    c.setFillColor(AMBER)
    c.circle(536, yy + 3.5, 2, stroke=0, fill=1)
    yy = text([item], 546, yy, size=10.2, color=INK, lead=1.45, width=372) - 5
footer(7)
c.showPage()

# ------------------------------------------------------------------ 8. climax
page_bg()
title('The colossus, and the valley beyond', 'Lux3D articulation drives the chase; Aholo World paints the ending')
picture(img('shot_colossus_06.png'), 40, 120, 432, 243, 'Colossus wakes: articulated shoulder slam')
picture(img('report_cover.png'), 488, 120, 432, 243, 'Finale: Aholo World Gaussian-splat valley')
text([
    'The escape is a single run across a crumbling causeway: dash the gap, charge the cracked wall as Stone, swim as Wood '
    'and run through the beam as Glass to keep the last gate open, while the colossus slams the path behind you.',
], 40, 96, size=11, color=INK, width=880)
footer(8)
c.showPage()

# ------------------------------------------------------------------ 9. tech + play
page_bg()
title('Under the hood, and how to play')
text([
    'Engine: three.js r187, custom swept-box physics, postprocessing + N8AO, Spark (Gaussian splats), WebCodecs capture.',
    'Sound: ElevenLabs narration, effects, ambience and music (pipeline/eleven.mjs), mixed in Web Audio with voice ducking.',
    'Frame: scene → AO → height fog → volumetric sun → DOF → bloom, AgX tone map, grade → SMAA. ~2–3 ms at 1080p on an',
    'Apple-silicon laptop; quality steps down automatically on slower GPUs (or ?quality=low|medium|high).',
    'Testing: scripted routes for every puzzle and the full escape run headlessly through the debug API before release.',
    'Never hard-fails: every generated model has a procedural fallback.',
    "Maker's Archive (press G on the title screen): every Lux3D model on a turntable with its prompt, Aholo operation,",
    'triangle count and generation time; the rigged hero performs its retargeted clips, the colossus and moth their joints.',
], 40, H - 110, size=11.2, color=INK, lead=1.55)
text(['Controls'], 40, H - 250, size=14, color=AMBER, font='Helvetica-Bold')
text([
    'W A S D or arrow keys move · Space jump (double jump, wall jump) · Shift dash / charge as Stone',
    '1–4 or Q change material · E pass your material to a block · C pound in mid-air as Stone · Esc pause',
    'Hold Enter to skip a cutscene · gamepad supported · desktop browser with WebGL 2, no install, no sign-in',
], 40, H - 272, size=11.2, color=INK, lead=1.55)
text(['Links'], 40, H - 350, size=14, color=AMBER, font='Helvetica-Bold')
text([f'Play: {PLAY_LINK}   ·   Video: {VIDEO_LINK}   ·   X: #Manycorehackathon'], 40, H - 372, size=11.2, color=INK)
footer(9)
c.showPage()
c.save()
print('wrote', os.path.join('docs', 'report', f'{team} + Matterborn.pdf'))
