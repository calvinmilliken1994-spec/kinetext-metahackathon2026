"""Build the two library .txt transcriptions from the fetched HTML (main article text only)."""
import hashlib, html, re, sys
from bs4 import BeautifulSoup

OUT = 'C:/projects/meta-hackathon/data/sources/'


def norm(s: str) -> str:
    s = s.replace('\u00a0', ' ')
    return re.sub(r'\s+', ' ', s).strip()


def blocks_from_html(fragment: str) -> list[str]:
    # Block-level tags become paragraph breaks; inline tags are dropped without inserting spaces.
    frag = re.sub(r'(?is)<(script|style)\b.*?</\1>', '', fragment)
    frag = re.sub(r'(?i)<sub>(.*?)</sub>', r'\1', frag)  # SiO<sub>2</sub> -> SiO2
    frag = re.sub(r'(?i)</?(p|div|td|tr|table|hr|br|h[1-6]|header|li|ul|ol)\b[^>]*>', '\n\n', frag)
    frag = re.sub(r'(?s)<[^>]+>', '', frag)
    frag = html.unescape(frag)
    out = []
    for b in re.split(r'\n\s*\n', frag):
        t = norm(b)
        if t:
            out.append(t)
    return out


def write(id_: str, title: str, paras: list[str]) -> None:
    text = '# ' + title + '\n\n' + '\n\n'.join(paras) + '\n'
    assert '\r' not in text
    with open(OUT + id_ + '.txt', 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    print(id_, len(text), 'chars', hashlib.sha256(text.encode('utf-8')).hexdigest())


# ---- NASA Glenn: Airplane Parts and Function ----
soup = BeautifulSoup(open('plane.html', 'rb').read(), 'html.parser')
main = soup.find('div', class_='usa-layout-docs-main_content')
title = norm(main.find('h1').get_text())
paras = []
for el in main.find_all(['p', 'h2'], recursive=False):
    if el.find('img'):
        continue  # the figure itself (stored separately)
    t = norm(el.get_text(''))
    if t:
        paras.append(t)
write('nasa-grc-airplane-parts-function', title, paras)

# ---- USGS Fact Sheet 002-97: What Are Volcano Hazards? ----
raw = open('volc_old.html', 'rb').read().decode('utf-8')
blocks = blocks_from_html(raw)
start = next(i for i, b in enumerate(blocks) if b.startswith('Volcanoes give rise'))
end = next(i for i, b in enumerate(blocks) if b.startswith('To help protect lives and property'))
body = blocks[start:end + 1]
fffd = sum(b.count('\ufffd') for b in body)
body = [b.replace('\ufffd', '\u2019') for b in body]
print('U+FFFD replaced:', fffd)
write('usgs-volcano-hazards', 'What Are Volcano Hazards?', body)
for b in body:
    print('  |', b[:110])
