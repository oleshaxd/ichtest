#!/usr/bin/env python3
"""Fetch Idle Champions definitions and build helper data.

The game API may return upgrade tables either as one upgrade_defines array or
as sharded upgrade_defines_0, upgrade_defines_1, ... arrays.
"""
import json
import sys
import urllib.request
from pathlib import Path

URLS = [
    "https://ps20.idlechampions.com/~idledragons/post.php?call=getDefinitions",
    "https://master.idlechampions.com/~idledragons/post.php?call=getdefinitions",
    "http://master.idlechampions.com/~idledragons/post.php?call=getdefinitions",
    "http://ps20.idlechampions.com/~idledragons/post.php?call=getdefinitions",
]
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)


def fetch():
    last = None
    for url in URLS:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "IdleChampionsHelper-data-import/1.1"})
            with urllib.request.urlopen(req, timeout=90) as response:
                raw = response.read()
            parsed = json.loads(raw)
            if isinstance(parsed, dict) and isinstance(parsed.get("hero_defines"), list):
                upgrades = collect_upgrades(parsed)
                if upgrades:
                    return parsed, upgrades, url
            preview = raw[:250].decode("utf-8", errors="replace").replace("\\n", " ")
            last = ValueError(f"Unexpected response from {url}: {preview}")
        except Exception as exc:
            last = exc
    raise RuntimeError(f"Could not fetch public game definitions: {last}")


def collect_upgrades(source):
    """Flatten all upgrade definition tables, preserving source order."""
    result = []
    if isinstance(source.get("upgrade_defines"), list):
        result.extend(source["upgrade_defines"])
    sharded = sorted(
        (key for key, value in source.items()
         if key.startswith("upgrade_defines_") and isinstance(value, list)),
        key=lambda key: int(key.rsplit("_", 1)[-1]) if key.rsplit("_", 1)[-1].isdigit() else key,
    )
    for key in sharded:
        result.extend(source[key])
    return result


def main():
    source, upgrades, source_url = fetch()
    heroes = source["hero_defines"]
    hero_by_id = {str(h.get("id")): h for h in heroes if h.get("id") is not None}
    valid_heroes = {
        str(hero.get("id")): hero for hero in heroes
        if hero.get("id") is not None and (hero.get("english_name") or hero.get("name"))
    }

    by_hero = {hid: [] for hid in valid_heroes}
    spec_names = {}
    for up in upgrades:
        hid = str(up.get("hero_id", ""))
        if hid not in valid_heroes:
            continue
        by_hero[hid].append({k: v for k, v in up.items() if k != "graphic_id"})
        spec = up.get("specialization_name")
        if isinstance(spec, str) and spec.strip():
            # The page roster uses English champion names; specialization labels
            # remain in the game's localized language when that is what the API returns.
            name = valid_heroes[hid].get("english_name") or valid_heroes[hid].get("name")
            choices = spec_names.setdefault(name, [])
            if spec.strip() not in choices:
                choices.append(spec.strip())

    payload = {
        "schemaVersion": 1,
        "source": source_url,
        "generatedAt": source.get("current_time"),
        "heroes": [
            {
                **{k: v for k, v in hero.items() if k != "graphic_id"},
                "upgrades": by_hero.get(str(hero.get("id")), []),
            }
            for hero in valid_heroes.values()
        ],
        "attack_defines": source.get("attack_defines", []),
        "ability_defines": source.get("ability_defines", []),
        "effect_defines": source.get("effect_defines", []),
        "effect_key_defines": source.get("effect_key_defines", []),
        "buff_defines": source.get("buff_defines", []),
        "text_defines": source.get("text_defines", []),
        "game_rule_defines": source.get("game_rule_defines", []),
    }
    (DATA / "game-definitions.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\\n",
        encoding="utf-8",
    )

    spec_payload = {
        "schemaVersion": 1,
        "source": source_url,
        "generatedAt": source.get("current_time"),
        "sourceNote": (
            "Generated from the public game definitions. Unique specialization_name values "
            "are listed per champion; choices from different specialization tiers are combined."
        ),
        "champions": spec_names,
    }
    (DATA / "specializations.json").write_text(
        json.dumps(spec_payload, ensure_ascii=False, indent=2) + "\\n",
        encoding="utf-8",
    )
    print(
        f"Imported {len(valid_heroes)} champions, {len(upgrades)} upgrades, "
        f"{sum(map(len, by_hero.values()))} champion upgrades, "
        f"{sum(map(len, spec_names.values()))} specialization options."
    )
    if not spec_names:
        raise RuntimeError("No specialization names found; refusing to publish an empty database.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
