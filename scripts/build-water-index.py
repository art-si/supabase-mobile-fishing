"""Build read-only H5 shoreline tiles from an OpenStreetMap extract (ODbL)."""

import argparse
from collections import defaultdict
from itertools import chain
from datetime import datetime, timezone
import json
from math import floor
from pathlib import Path
from tempfile import TemporaryDirectory

from shapely import get_parts, make_valid, simplify
from shapely.geometry import box, mapping, shape


CELL_SIZE = 0.25
# Beyond the 2 km search radius even at China's northernmost latitudes.
PADDING = 0.04
TAGS = (("natural", "water"), ("waterway", "riverbank"), ("landuse", "reservoir"))


def osm_surfaces(path, index):
    import osmium

    factory = osmium.geom.GeoJSONFactory()
    water = osmium.filter.TagFilter(*TAGS)
    processor = (osmium.FileProcessor(str(path))
                 .with_locations(f"sparse_file_array,{index}")
                 .with_areas(water)
                 .with_filter(osmium.filter.EntityFilter(osmium.osm.AREA))
                 .with_filter(water))
    for area in processor:
        tags = area.tags
        if tags.get("covered") == "yes" or tags.get("tunnel") == "yes":
            continue
        name = tags.get("name:zh-Hans") or tags.get("name:zh") or tags.get("name") or ""
        kind = "way" if area.from_way() else "relation"
        try:
            geometry = factory.create_multipolygon(area)
        except osmium.InvalidLocationError:
            continue
        yield f"{kind}/{area.orig_id()}", name, shape(json.loads(geometry))


def geojson_surfaces(path):
    with path.open(encoding="utf-8-sig") as file:
        document = json.load(file)
    for feature in document["features"]:
        properties = feature["properties"]
        yield properties["id"], properties.get("name") or "", shape(feature["geometry"])


def pbf_snapshot(path):
    import osmium

    reader = osmium.io.Reader(str(path), osmium.osm.NOTHING)
    try:
        stamp = reader.header().get("osmosis_replication_timestamp")
    finally:
        reader.close()
    return stamp[:10] if stamp else None


def polygons(geometry):
    if geometry.geom_type == "Polygon":
        if not geometry.is_empty:
            yield geometry
    elif geometry.geom_type in ("MultiPolygon", "GeometryCollection"):
        for part in get_parts(geometry):
            yield from polygons(part)


def index_surfaces(surfaces):
    tiles = defaultdict(list)
    for identifier, name, geometry in surfaces:
        for polygon in polygons(simplify(make_valid(geometry), 0.00001, preserve_topology=True)):
            west, south, east, north = polygon.bounds
            for x in range(floor((west - PADDING) / CELL_SIZE), floor((east + PADDING) / CELL_SIZE) + 1):
                for y in range(floor((south - PADDING) / CELL_SIZE), floor((north + PADDING) / CELL_SIZE) + 1):
                    bounds = box(x * CELL_SIZE - PADDING, y * CELL_SIZE - PADDING,
                                 (x + 1) * CELL_SIZE + PADDING, (y + 1) * CELL_SIZE + PADDING)
                    coords = [[[tuple(round(value, 6) for value in point) for point in ring]
                               for ring in mapping(piece)["coordinates"]]
                              for piece in polygons(polygon.intersection(bounds))]
                    if coords:
                        tiles[f"{x}_{y}"].append(json.dumps(
                            {"id": identifier, "name": name, "coordinates": coords},
                            ensure_ascii=False, separators=(",", ":")
                        ))
    return tiles


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="+", type=Path, help="OSM .pbf or water-only .geojson (WGS84)")
    parser.add_argument("--source-url", action="append", required=True, help="One URL per source in order")
    parser.add_argument("--snapshot", help="Snapshot date override (YYYY-MM-DD), defaults to each PBF header")
    parser.add_argument("--output", type=Path, default=Path("artifacts/water-index"))
    args = parser.parse_args()
    if len(args.source_url) != len(args.source):
        parser.error("Provide one --source-url per source file")
    sources = []
    for path, url in zip(args.source, args.source_url):
        date = args.snapshot or (pbf_snapshot(path) if path.suffix == ".pbf" else None)
        if not date:
            parser.error(f"--snapshot is required for {path.name} without a replication timestamp")
        sources.append({"url": url, "snapshot": datetime.strptime(date, "%Y-%m-%d").date().isoformat()})
    args.output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=args.output.parent, prefix="water-index-", ignore_cleanup_errors=True) as temp:
        stage = Path(temp)
        surfaces = chain.from_iterable(
            osm_surfaces(path, stage / f"node-locations-{i}")
            if path.suffix == ".pbf" else geojson_surfaces(path)
            for i, path in enumerate(args.source)
        )
        tiles = index_surfaces(surfaces)
        if not tiles:
            raise ValueError("The source contains no usable water surfaces")
        version = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        release = stage / version
        release.mkdir()
        total_bytes = 0
        largest_tile = 0
        for key, records in tiles.items():
            content = ("[" + ",".join(records) + "]").encode("utf-8")
            (release / f"{key}.json").write_bytes(content)
            total_bytes += len(content)
            largest_tile = max(largest_tile, len(content))
        manifest = stage / "manifest.json"
        manifest.write_text(json.dumps({
            "version": version,
            "snapshot": min(source["snapshot"] for source in sources),
            "sources": sources,
            "license": "ODbL-1.0",
            "tiles": sorted(tiles)
        }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        release.rename(args.output / version)
        manifest.replace(args.output / "manifest.json")
        print(f"Built {len(tiles)} water tiles ({total_bytes:,} bytes, largest {largest_tile:,} bytes) in {args.output}")


if __name__ == "__main__":
    main()
