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
    # DNS failures can be transient on hosted runners. Retry each endpoint before
    # falling back to the next known game API host.
    for url in URLS:
        for attempt in range(3):
            try:
                req = urllib.request.Request(
                    url,
                    headers={"User-Agent": "IdleChampionsHelper-data-import/1.1"},
                )
                with urllib.request.urlopen(req, timeout=45) as response:
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
            if attempt < 2:
                import time
                delay = 2 ** (attempt + 1)
                print(f"Fetch attempt {attempt + 1}/3 failed for {url}: {last}; retrying in {delay}s", flush=True)
                time.sleep(delay)
    raise RuntimeError(
        "Could not fetch public game definitions after retrying all known endpoints. "
        f"Last error: {last}. If this is a name-resolution error, rerun the workflow "
        "later or provide the game's cached_definitions.json as an offline source."
    )


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
    valid_heroes = {
        str(hero.get("id")): hero for hero in heroes
        if hero.get("id") is not None and (hero.get("english_name") or hero.get("name"))
    }

    by_hero = {hid: [] for hid in valid_heroes}
    spec_names = {}
    spec_tiers = {}
    for up in upgrades:
        hid = str(up.get("hero_id", ""))
        if hid not in valid_heroes:
            continue
        by_hero[hid].append({k: v for k, v in up.items() if k != "graphic_id"})
        spec = up.get("specialization_name")
        if isinstance(spec, str) and spec.strip():
            name = valid_heroes[hid].get("english_name") or valid_heroes[hid].get("name")
            choices = spec_names.setdefault(name, [])
            if spec.strip() not in choices:
                choices.append(spec.strip())

            level = up.get("required_level")
            try:
                level = int(level) if level is not None else 0
            except (TypeError, ValueError):
                level = 0
            tiers = spec_tiers.setdefault(name, {})
            tier = tiers.setdefault(level, {})
            choice = tier.setdefault(spec.strip(), {
                "name": spec.strip(),
                "description": (up.get("specialization_description") or "").strip(),
                "upgradeIds": [],
                "effects": [],
            })
            upgrade_id = up.get("id")
            if upgrade_id is not None and upgrade_id not in choice["upgradeIds"]:
                choice["upgradeIds"].append(upgrade_id)
            effect = up.get("effect")
            if isinstance(effect, str) and effect.strip() and effect not in choice["effects"]:
                choice["effects"].append(effect)

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
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    tier_payload = {}
    for hero_name, levels in spec_tiers.items():
        tier_payload[hero_name] = [
            {"level": level, "choices": list(choices.values())}
            for level, choices in sorted(levels.items(), key=lambda item: item[0])
        ]

    spec_payload = {
        "schemaVersion": 2,
        "source": source_url,
        "generatedAt": source.get("current_time"),
        "sourceNote": (
            "Specialization choices are grouped by required_level. Descriptions and raw "
            "upgrade effect strings come from game definitions; effect strings are not "
            "themselves a complete damage simulation formula."
        ),
        "champions": spec_names,
        "tiers": tier_payload,
    }
    (DATA / "specializations.json").write_text(
        json.dumps(spec_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Imported {len(valid_heroes)} champions, {len(upgrades)} upgrades, "
        f"{sum(map(len, by_hero.values()))} champion upgrades, "
        f"{sum(map(len, spec_names.values()))} unique specialization names across champions, "
        f"{sum(len(tiers) for tiers in tier_payload.values())} specialization tiers."
    )
    if not spec_names:
        raise RuntimeError("No specialization names found; refusing to publish an empty database.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
