"""Merge 1x + 2x Windows OCR into candidate printed-label boxes (method of docs/evidence/stage-8b/label-boxes).
Each OCR line is split into separate labels where the word gap exceeds 1.2x the text height; 2x coordinates
are halved; boxes from both scales with IoU > 0.25 are unioned; every box is padded 3 px (clamped)."""
import json, sys

def line_boxes(path, scale):
    d = json.load(open(path, encoding='utf-8'))
    out = []
    for l in d['lines']:
        ws = sorted(l['words'], key=lambda w: w['x'])
        cur = None
        for w in ws:
            x1, y1, x2, y2 = w['x'] / scale, w['y'] / scale, (w['x'] + w['w']) / scale, (w['y'] + w['h']) / scale
            if cur is not None:
                h = max(cur['y2'] - cur['y1'], y2 - y1)
                if x1 - cur['x2'] > 1.2 * h:
                    out.append(cur); cur = None
            if cur is None:
                cur = {'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2, 'ocr': w['text']}
            else:
                cur.update(x1=min(cur['x1'], x1), y1=min(cur['y1'], y1), x2=max(cur['x2'], x2), y2=max(cur['y2'], y2))
                cur['ocr'] += ' ' + w['text']
        if cur is not None:
            out.append(cur)
    return out

def iou(a, b):
    iw = min(a['x2'], b['x2']) - max(a['x1'], b['x1']); ih = min(a['y2'], b['y2']) - max(a['y1'], b['y1'])
    if iw <= 0 or ih <= 0: return 0.0
    i = iw * ih
    A = (a['x2'] - a['x1']) * (a['y2'] - a['y1']); B = (b['x2'] - b['x1']) * (b['y2'] - b['y1'])
    return i / (A + B - i)

def merge(name, W, H):
    boxes = [dict(b, src='1x') for b in line_boxes(f'ocr_{name}_1x.json', 1)] + \
            [dict(b, src='2x') for b in line_boxes(f'ocr_{name}_2x.json', 2)]
    merged = []
    for b in boxes:
        hit = next((m for m in merged if iou(m, b) > 0.25), None)
        if hit is None:
            merged.append(dict(b))
        else:
            hit.update(x1=min(hit['x1'], b['x1']), y1=min(hit['y1'], b['y1']), x2=max(hit['x2'], b['x2']), y2=max(hit['y2'], b['y2']))
            hit['ocr'] += ' | ' + b['ocr']; hit['src'] += '+' + b['src']
    out = []
    for m in merged:
        out.append({'x1': max(0, int(m['x1']) - 3), 'y1': max(0, int(m['y1']) - 3),
                    'x2': min(W, int(-(-m['x2'] // 1)) + 3), 'y2': min(H, int(-(-m['y2'] // 1)) + 3),
                    'ocr': m['ocr'], 'src': m['src']})
    out.sort(key=lambda b: (b['y1'], b['x1']))
    json.dump(out, open(f'cand_{name}.json', 'w', encoding='utf-8'), indent=1)
    for i, b in enumerate(out):
        print(i, b['x1'], b['y1'], b['x2'], b['y2'], b['src'], b['ocr'])

merge(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]))
