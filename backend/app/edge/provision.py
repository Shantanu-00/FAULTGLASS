from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from ..db import create_pool
from ..env import optional, require
from ..plant import load_pack
from ..repositories.edge_nodes import EdgeNodeRepository

DEFAULT_PLANT_DIR = Path(__file__).resolve().parents[3] / "plants" / "waterplant"


async def main() -> None:
    parser = argparse.ArgumentParser(description="Create or rotate the credentials of an edge node")
    parser.add_argument("node_id")
    args = parser.parse_args()
    pack = load_pack(Path(optional("PLANT_DIR", str(DEFAULT_PLANT_DIR))))
    node = next((n for n in pack.edge_nodes if n.id == args.node_id), None)
    if node is None:
        raise SystemExit(f"{args.node_id} is not an edge node of plant {pack.manifest.id}")
    pool = create_pool(require("DATABASE_URL"))
    await pool.open()
    try:
        key = await EdgeNodeRepository(pool).provision(node.id, pack.manifest.id, node.name)
    finally:
        await pool.close()
    print(f"EDGE_NODE_ID={node.id}\nEDGE_API_KEY={key}")


if __name__ == "__main__":
    asyncio.run(main())
