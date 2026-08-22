# -*- coding: utf-8 -*-
"""和文Webフォントを、そのサイトが実際に使う文字だけに切って自前配信に置き換える。

なぜ必要か
----------
Google Fonts の和文は unicode-range で百数十個に分割配信される。ページが多様な漢字を
使うほど多くの断片を取りに行くので、demo4-sugito の実測では 110ファイル・約2.5MB あった。
ページ本体（HTML 22KB ＋ 画像 96KB）の20倍で、ここが表示速度の主因になっていた。

被覆の考え方（実測にもとづく）
------------------------------
  使用字のみ                  129 KB
  使用字＋かな英数記号        334 KB   ← これを採用
  ＋JIS第1水準漢字          2,131 KB   ← 18%しか減らない。重さの本体は漢字

かなと英数を全部載せても誤差の範囲なので固定で入れる（送り仮名の直し・フォーム入力に効く）。
漢字は使う字だけ。**文言に新しい漢字を足したら、このスクリプトを流し直すこと。**
流し忘れると、その字だけ環境依存のフォントで出る（--check で検出できる）。

使い方（portfolio/ で実行する）
------------------------------
  python tools/subset-fonts.py demo4-sugito          # woff2 を生成し、貼るCSSを出す
  python tools/subset-fonts.py demo4-sugito --check  # 生成せず、字が欠けていないかだけ見る
  python tools/subset-fonts.py --all

必要なもの: pip install fonttools brotli
元フォントは tools/.fontcache/ に貯める（初回だけ Google から取る。gitには入れない）。
"""
from __future__ import annotations

import argparse
import html as htmllib
import io
import json
import os
import re
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

PORTFOLIO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".fontcache")

# unicode-range 非対応のUAで問い合わせると、Google は分割していない一枚物を返す
OLD_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 6.1; rv:30.0) Gecko/20100101 Firefox/30.0"}

# サイトごとに使う書体。(Google Fontsのfamily名, CSSで書く名前, ウェイト, 斜体か)
# 欧文書体も混ぜてよい。和文の文字集合を渡しても、その書体に無い字は無視されるだけ。
SITES = {
    "demo1-toriai": [
        ("Shippori Mincho", "Shippori Mincho", 500, False),
        ("Shippori Mincho", "Shippori Mincho", 600, False),
        ("Shippori Mincho", "Shippori Mincho", 700, False),
        ("Zen Kaku Gothic New", "Zen Kaku Gothic New", 400, False),
        ("Zen Kaku Gothic New", "Zen Kaku Gothic New", 500, False),
        ("Zen Kaku Gothic New", "Zen Kaku Gothic New", 700, False),
    ],
    "demo2-marukin": [
        ("Yusei Magic", "Yusei Magic", 400, False),
        ("Zen Kaku Gothic New", "Zen Kaku Gothic New", 400, False),
        ("Zen Kaku Gothic New", "Zen Kaku Gothic New", 500, False),
        ("Zen Kaku Gothic New", "Zen Kaku Gothic New", 700, False),
    ],
    "demo3-shoku": [
        ("Noto Serif JP", "Noto Serif JP", 300, False),
        ("Noto Serif JP", "Noto Serif JP", 400, False),
        ("Noto Serif JP", "Noto Serif JP", 500, False),
        ("Cormorant Garamond", "Cormorant Garamond", 400, False),
        ("Cormorant Garamond", "Cormorant Garamond", 600, False),
        ("Cormorant Garamond", "Cormorant Garamond", 400, True),
    ],
    "demo4-sugito": [
        ("Noto Sans JP", "Noto Sans JP", 400, False),
        ("Noto Sans JP", "Noto Sans JP", 500, False),
        ("Noto Serif JP", "Noto Serif JP", 400, False),
        ("Noto Serif JP", "Noto Serif JP", 500, False),
    ],
    "demo5-kobiki": [
        ("Noto Serif JP", "Noto Serif JP", 400, False),
        ("Noto Sans JP", "Noto Sans JP", 400, False),
    ],
    "noren": [
        ("Noto Sans JP", "Noto Sans JP", 400, False),
        ("Noto Serif JP", "Noto Serif JP", 400, False),
        ("Noto Serif JP", "Noto Serif JP", 700, False),
        ("DM Serif Display", "DM Serif Display", 400, False),
    ],
}


def face_file(css_name: str, weight: int, italic: bool) -> str:
    return f"{css_name.replace(' ', '')}-{weight}{'i' if italic else ''}.woff2"


def ku_chars(ku: int) -> list[str]:
    """JIS X 0208 の1区分を取り出す。外部データに頼らず区点から生成する。"""
    out = []
    for ten in range(1, 95):
        try:
            out.append(bytes([0xA0 + ku, 0xA0 + ten]).decode("euc_jp"))
        except UnicodeDecodeError:
            pass
    return out


def fixed_coverage(full_kana: bool) -> set[str]:
    """常に載せる分。

    ASCII と基本記号は必ず。かな全部（ひらがな83＋カタカナ86＋全角英数）は
    **入力欄のあるページだけ**。来訪者が何を打つか分からないため。
    入力欄が無いページは書いてある文字しか出ないので、載せると1面あたり
    30〜50KB ほど無駄になる（demo5 実測: 98KB → 197KB）。
    """
    s = {chr(c) for c in range(0x20, 0x7F)}
    for ku in (1, 2):                   # 記号・約物。組版で混ざりやすいので常に入れる
        s |= set(ku_chars(ku))
    s |= set("〜－―…‥※→←↑↓")
    if full_kana:
        for ku in (3, 4, 5):            # 全角英数 / ひらがな / カタカナ
            s |= set(ku_chars(ku))
        s |= set("①②③④⑤⑥⑦⑧⑨⑩㎡℃")
    return s


def has_text_input(src: str) -> bool:
    """来訪者が文字を打てる欄があるか。あればかなを全部載せる。"""
    return bool(re.search(r"<textarea|<input[^>]+type=[\"']?(text|search|email|tel|url|password)", src, re.I))


def page_text(path: str) -> tuple[str, str]:
    """HTMLから、画面に出る文字だけを拾う。scriptとstyleとコメントは除く。"""
    src = io.open(path, encoding="utf-8").read()
    return _visible(src), src


def _visible(src: str) -> str:
    scripts = re.findall(r"<script[^>]*>(.*?)</script>", src, flags=re.S)
    body = re.sub(r"<script[^>]*>.*?</script>", " ", src, flags=re.S)
    styles = re.findall(r"<style[^>]*>(.*?)</style>", body, flags=re.S)
    body = re.sub(r"<style[^>]*>.*?</style>", " ", body, flags=re.S)
    body = re.sub(r"<!--.*?-->", " ", body, flags=re.S)
    # alt/aria-label/title/data-label は読み上げや代替表示で出るので拾う
    shown = " ".join(re.findall(r'(?:alt|aria-label|title|data-label|content)="([^"]*)"', body))
    body = re.sub(r"<[^>]+>", " ", body)

    # JS が差し込む文字と、CSS の content: に書いた文字も画面に出る。
    # 静的HTMLだけ見ていると、ここが丸ごと抜けて「その字だけ別のフォント」になる。
    # 文字列リテラルから和文だけ拾う（過剰に拾っても、無い字は無視されるだけ）
    dynamic = []
    for blk in scripts:
        for lit in re.findall(r"""(['"`])((?:\\.|(?!\1)[^\\])*)\1""", blk):
            dynamic.append(lit[1])
    for blk in styles:
        dynamic += re.findall(r'content:\s*"([^"]*)"', blk)
    dyn = "".join(c for c in "".join(dynamic) if ord(c) >= 0x2E80 or ord(c) in (0x2015, 0x2026, 0x203B))

    return htmllib.unescape(body + " " + shown) + dyn


def source_font(family: str, weight: int, italic: bool = False) -> str:
    """分割前のフォントを取ってきて .fontcache に置く。2回目からはそれを使う。"""
    os.makedirs(CACHE, exist_ok=True)
    slug = family.replace(" ", "")
    path = os.path.join(CACHE, f"{slug}-{weight}{'i' if italic else ''}.woff")
    if os.path.exists(path) and os.path.getsize(path) > 5_000:
        return path
    q = family.replace(" ", "+")
    q += f":ital,wght@{1 if italic else 0},{weight}" if italic else f":wght@{weight}"
    css = urllib.request.urlopen(
        urllib.request.Request(f"https://fonts.googleapis.com/css2?family={q}", headers=OLD_UA),
        timeout=120,
    ).read().decode()
    urls = re.findall(r"url\((https[^)]+)\)", css)
    if not urls:
        raise RuntimeError(f"{family} {weight}{'i' if italic else ''} の元フォントURLが取れない")
    data = urllib.request.urlopen(
        urllib.request.Request(urls[0], headers=OLD_UA), timeout=300
    ).read()
    io.open(path, "wb").write(data)
    print(f"    元フォント取得 {family} {weight}{'i' if italic else ''}: {len(data)//1024} KB")
    return path


def subset(src: str, out: str, text: str) -> int:
    from fontTools import subset as ftsubset

    ftsubset.main([
        src,
        f"--text={text}",
        f"--output-file={out}",
        "--flavor=woff2",
        "--no-hinting",
        "--desubroutinize",
        "--notdef-outline",
        # 縦組み(vert/vrt2)や約物詰め(palt)を落とすと組版が崩れるので全部残す
        "--layout-features=*",
    ])
    return os.path.getsize(out)


FACE_TMPL = """@font-face {{
  font-family: "{css_name}"; font-style: {style}; font-weight: {weight}; font-display: swap;
  src: url("fonts/{file}") format("woff2");
}}"""


def build(site: str, check_only: bool = False) -> bool:
    site_dir = os.path.join(PORTFOLIO, site)
    index = os.path.join(site_dir, "index.html")
    if not os.path.exists(index):
        print(f"{site}: index.html がない"); return False

    text, raw = page_text(index)
    used = set(text) - set(" \t\r\n　")
    kana = has_text_input(raw)
    cover = fixed_coverage(kana) | used
    kanji = sorted(c for c in used if "一" <= c <= "鿿")
    print(f"{site}: 表示文字 {len(used)} 種（うち漢字 {len(kanji)}）／被覆 {len(cover)} 字"
          f"／かな全載せ {'あり（入力欄がある）' if kana else 'なし'}")

    if check_only:
        missing = []
        for _, css_name, w, ital in SITES[site]:
            f = os.path.join(site_dir, "fonts", face_file(css_name, w, ital))
            if not os.path.exists(f):
                missing.append(f"{css_name} {w}{'i' if ital else ''}: ファイルがない")
                continue
            from fontTools.ttLib import TTFont
            cmap = set()
            for t in TTFont(f)["cmap"].tables:
                cmap |= set(t.cmap.keys())
            # 欧文書体に和文が無いのは当然なので、その書体が元々持つ範囲だけを見る
            lack = sorted(c for c in used if ord(c) not in cmap and ord(c) < 0x2E80)
            jp_lack = sorted(c for c in used if ord(c) not in cmap and ord(c) >= 0x2E80)
            if jp_lack and len(cmap) > 1000:      # 和文書体なのに和文が欠けている
                missing.append(f"{css_name} {w}: 和文 {len(jp_lack)}字が欠けている → {''.join(jp_lack[:30])}")
            if lack and len(cmap) > 1000:
                missing.append(f"{css_name} {w}: 欧文 {len(lack)}字が欠けている → {''.join(lack[:30])}")
        if missing:
            print("  欠落あり。生成し直しが要る:")
            for m in missing:
                print("   ", m)
            return False
        print("  欠落なし")
        return True

    os.makedirs(os.path.join(site_dir, "fonts"), exist_ok=True)
    txt = "".join(sorted(cover))
    faces, total = [], 0
    for gf_family, css_name, w, ital in SITES[site]:
        src = source_font(gf_family, w, ital)
        name = face_file(css_name, w, ital)
        size = subset(src, os.path.join(site_dir, "fonts", name), txt)
        total += size
        faces.append((css_name, w, ital, name, size))
        print(f"    {name}: {size//1024} KB")
    print(f"  合計 {total//1024} KB")

    css = "\n".join(
        FACE_TMPL.format(css_name=n, weight=w, file=f,
                         style="italic" if i else "normal")
        for n, w, i, f, _ in faces)
    print("\n--- HTMLに入れる @font-face ---")
    print(css)
    print("--- preload は「最初の画面で描かれる書体」だけに絞ること ---")
    for n, w, i, f, s in faces:
        print(f'<link rel="preload" href="fonts/{f}" as="font" type="font/woff2" crossorigin>'
              f'   <!-- {n} {w}{"i" if i else ""} / {s//1024}KB -->')
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("site", nargs="?")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    targets = list(SITES) if a.all else ([a.site] if a.site else [])
    if not targets:
        print("対象サイトを指定する。例: python tools/subset-fonts.py demo4-sugito")
        print("設定済み:", ", ".join(SITES))
        return 1
    ok = True
    for s in targets:
        if s not in SITES:
            print(f"{s}: SITES に未登録"); ok = False; continue
        ok = build(s, a.check) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
