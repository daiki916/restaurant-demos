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

# サイトごとに使う書体。Google Fonts の family 名 → CSSで使う名前とウェイト
SITES = {
    "demo4-sugito": [
        ("Noto Sans JP", "Noto Sans JP", [400, 500]),
        ("Noto Serif JP", "Noto Serif JP", [400, 500]),
    ],
}


def ku_chars(ku: int) -> list[str]:
    """JIS X 0208 の1区分を取り出す。外部データに頼らず区点から生成する。"""
    out = []
    for ten in range(1, 95):
        try:
            out.append(bytes([0xA0 + ku, 0xA0 + ten]).decode("euc_jp"))
        except UnicodeDecodeError:
            pass
    return out


def fixed_coverage() -> set[str]:
    """常に載せる分。ASCII・記号・全角英数・ひらがな・カタカナ。"""
    s = {chr(c) for c in range(0x20, 0x7F)}
    for ku in (1, 2, 3, 4, 5):          # 記号 / 記号2 / 全角英数 / ひらがな / カタカナ
        s |= set(ku_chars(ku))
    s |= set("〜－―…‥※→←↑↓①②③④⑤⑥⑦⑧⑨⑩㎡℃")
    return s


def page_text(path: str) -> str:
    """HTMLから、画面に出る文字だけを拾う。scriptとstyleとコメントと属性は除く。"""
    src = io.open(path, encoding="utf-8").read()
    body = re.sub(r"<script[^>]*>.*?</script>", " ", src, flags=re.S)
    body = re.sub(r"<style[^>]*>.*?</style>", " ", body, flags=re.S)
    body = re.sub(r"<!--.*?-->", " ", body, flags=re.S)
    # alt/aria-label/title/data-label は読み上げや代替表示で出るので拾う
    shown = " ".join(re.findall(r'(?:alt|aria-label|title|data-label|content)="([^"]*)"', body))
    body = re.sub(r"<[^>]+>", " ", body)
    return htmllib.unescape(body + " " + shown)


def source_font(family: str, weight: int) -> str:
    """分割前のフォントを取ってきて .fontcache に置く。2回目からはそれを使う。"""
    os.makedirs(CACHE, exist_ok=True)
    slug = family.replace(" ", "")
    path = os.path.join(CACHE, f"{slug}-{weight}.woff")
    if os.path.exists(path) and os.path.getsize(path) > 100_000:
        return path
    q = family.replace(" ", "+") + f":wght@{weight}"
    css = urllib.request.urlopen(
        urllib.request.Request(f"https://fonts.googleapis.com/css2?family={q}", headers=OLD_UA),
        timeout=120,
    ).read().decode()
    urls = re.findall(r"url\((https[^)]+)\)", css)
    if not urls:
        raise RuntimeError(f"{family} {weight} の元フォントURLが取れない")
    data = urllib.request.urlopen(
        urllib.request.Request(urls[0], headers=OLD_UA), timeout=300
    ).read()
    io.open(path, "wb").write(data)
    print(f"    元フォント取得 {family} {weight}: {len(data)//1024} KB")
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
  font-family: "{css_name}";
  font-style: normal;
  font-weight: {weight};
  font-display: swap;
  src: url("fonts/{file}") format("woff2");
}}"""


def build(site: str, check_only: bool = False) -> bool:
    site_dir = os.path.join(PORTFOLIO, site)
    index = os.path.join(site_dir, "index.html")
    if not os.path.exists(index):
        print(f"{site}: index.html がない"); return False

    text = page_text(index)
    used = set(text) - set(" \t\r\n　")
    cover = fixed_coverage() | used
    kanji = sorted(c for c in used if "一" <= c <= "鿿")
    print(f"{site}: 表示文字 {len(used)} 種（うち漢字 {len(kanji)}）／被覆 {len(cover)} 字")

    if check_only:
        missing = []
        for _, css_name, weights in SITES[site]:
            for w in weights:
                f = os.path.join(site_dir, "fonts",
                                 f"{css_name.replace(' ', '')}-{w}.woff2")
                if not os.path.exists(f):
                    missing.append(f"{css_name} {w}: ファイルがない")
                    continue
                from fontTools.ttLib import TTFont
                cmap = set()
                for t in TTFont(f)["cmap"].tables:
                    cmap |= set(t.cmap.keys())
                lack = sorted(c for c in used if ord(c) not in cmap)
                if lack:
                    missing.append(f"{css_name} {w}: {len(lack)}字が欠けている → {''.join(lack[:30])}")
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
    for gf_family, css_name, weights in SITES[site]:
        for w in weights:
            src = source_font(gf_family, w)
            name = f"{css_name.replace(' ', '')}-{w}.woff2"
            size = subset(src, os.path.join(site_dir, "fonts", name), txt)
            total += size
            faces.append((css_name, w, name, size))
            print(f"    {name}: {size//1024} KB")
    print(f"  合計 {total//1024} KB")

    css = "\n".join(FACE_TMPL.format(css_name=n, weight=w, file=f) for n, w, f, _ in faces)
    print("\n--- HTMLに入れる @font-face ---")
    print(css)
    print("--- 先頭に置く preload（最初に描かれる書体だけ）---")
    print(f'<link rel="preload" href="fonts/{faces[0][2]}" as="font" '
          f'type="font/woff2" crossorigin>')
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
