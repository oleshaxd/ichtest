#!/usr/bin/env python3
"""Download champion portrait thumbnails using the Idle Champions Wiki search API."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
import json
import re
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
OUT = ROOT / "assets" / "champions"
API = "https://idlechampions.fandom.com/api.php"
HEADERS = {
    "User-Agent": "IdleChampionsHelper/1.1 (community fan project; portrait cache)",
    "Accept": "application/json,image/*,*/*",
}


def slug(name):
    name = unicodedata.normalize("NFKD", name)
    name = "".join(ch for ch in name if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def normalized(value):
    value = unicodedata.normalize("NFKD", value).lower()
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def names_from_index():
    html = INDEX.read_text(encoding="utf-8")
    raw = re.search(r"const raw = \[(.*?)\];", html, re.S)
    if not raw:
        raise RuntimeError("Could not find champion list in index.html")
    entries = re.findall(r'"([^"\n]*\|\d+\|[^"\n]*)"', raw.group(1))
    names = []
    for entry in entries:
        name = entry.split("|", 1)[0].strip()
        if name and name not in names:
            names.append(name)
    return names


def get_json(params):
    url = API + "?" + urlencode({"format": "json", **params})
    request = Request(url, headers=HEADERS)
    with urlopen(request, timeout=25) as response:
        return json.loads(response.read().decode("utf-8"))


def search_file_pages(name):
    # Search the wiki's File namespace instead of guessing the uploaded filename.
    data = get_json({
        "action": "query",
        "list": "search",
        "srnamespace": 6,
        "srlimit": 10,
        "srsearch": name,
    })
    return data.get("query", {}).get("search", [])


def choose_file(name, results):
    wanted = normalized(name).split()
    if not wanted:
        return None

    ranked = []
    for result in results:
        title = result.get("title", "")
        clean_title = normalized(re.sub(r"^File:", "", title, flags=re.I))
        # Require at least one meaningful name token to avoid unrelated search hits.
        matching = sum(1 for token in wanted if token in clean_title.split())
        if matching == 0:
            continue
        score = matching * 10
        if "portrait" in clean_title or "head" in clean_title or "avatar" in clean_title:
            score += 4
        if "icon" in clean_title or "mini" in clean_title:
            score += 2
        if "card" in clean_title or "background" in clean_title or "ability" in clean_title:
            score -= 5
        ranked.append((score, title))
    ranked.sort(reverse=True)
    return ranked[0][1] if ranked else None


def image_url_for_file(title):
    data = get_json({
        "action": "query",
        "titles": title,
        "prop": "imageinfo",
        "iiprop": "url|mime",
        "iiurlwidth": 320,
    })
    pages = data.get("query", {}).get("pages", {})
    for page in pages.values():
        info = page.get("imageinfo", [])
        if info:
            item = info[0]
            mime = item.get("mime", "")
            if mime.startswith("image/"):
                return item.get("thumburl") or item.get("url")
    return None


def exact_icon_title_candidates(name):
    # The Wiki's Icon_<Champion>.png files are the clean in-game portraits.
    # Try both underscore-separated and compact spellings (e.g. Hew Maan/HewMaan).
    safe = re.sub(r"[^A-Za-z0-9 _'-]", "", name).strip()
    variants = [safe.replace(" ", "_"), safe.replace(" ", "")]
    titles = []
    for variant in variants:
        title = f"File:Icon_{variant}.png"
        if title not in titles:
            titles.append(title)
    return titles


def download_one(name):
    target = OUT / f"{slug(name)}.png"
    try:
        title = None
        url = None
        # Prefer exact Icon_ files. If one exists, refresh even an already cached
        # portrait so incorrectly selected artwork is replaced by the clean icon.
        for candidate in exact_icon_title_candidates(name):
            candidate_url = image_url_for_file(candidate)
            if candidate_url:
                title, url = candidate, candidate_url
                break

        if not url:
            # Preserve existing images when no exact icon exists; these may have
            # been corrected manually. Only use search as a fallback for missing files.
            if target.exists() and target.stat().st_size > 500:
                return name, "cached (no exact Icon file found)"
            results = search_file_pages(name)
            title = choose_file(name, results)
            if not title:
                return name, "not found in Wiki file search"
            url = image_url_for_file(title)
            if not url:
                return name, f"no image URL for {title}"
        request = Request(url, headers={"User-Agent": HEADERS["User-Agent"]})
        with urlopen(request, timeout=30) as response:
            data = response.read()
            content_type = response.headers.get("Content-Type", "").lower()
        if len(data) < 500 or (content_type and not content_type.startswith("image/")):
            return name, f"invalid image response for {title}"
        with Image.open(BytesIO(data)) as original:
            original.seek(0)
            image = original.convert("RGBA")
            image = ImageOps.fit(
                image, (160, 160), method=Image.Resampling.LANCZOS,
                centering=(0.5, 0.42),
            )
            buffer = BytesIO()
            image.save(buffer, format="PNG", optimize=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(buffer.getvalue())
        time.sleep(0.1)
        return name, f"downloaded ({title})"
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError) as exc:
        return name, f"error: {type(exc).__name__}: {exc}"


def main():
    names = names_from_index()
    print(f"Found {len(names)} champions.")
    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(download_one, name) for name in names]
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            print(f"{result[0]}: {result[1]}", flush=True)

    ok = sum(status.startswith(("downloaded", "cached")) for _, status in results)
    missing = [(name, status) for name, status in results
               if not status.startswith(("downloaded", "cached"))]
    print(f"\nCached portraits: {ok}/{len(names)}; missing: {len(missing)}")
    if missing:
        print("Missing/details: " + "; ".join(f"{name} [{status}]" for name, status in missing))
    if ok == 0:
        raise SystemExit("No portraits downloaded; refusing to commit an empty cache.")


if __name__ == "__main__":
    main()
