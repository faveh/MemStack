"""Pull Multimodal-Mind2Web from Hugging Face into exam/data/ (gitignored).

  uv run --with duckdb --with lxml python -I exam/pull.py meta    # light columns, every split
  uv run --with duckdb --with lxml python -I exam/pull.py sample  # fixed-seed sample of whole tasks
  uv run --with duckdb --with lxml python -I exam/pull.py html    # cleaned_html + candidates, sampled rows only

`meta` skips screenshots, raw_html, cleaned_html and neg_candidates (most of the 4 GB).
`sample` picks whole tasks spread over sites (train: only sites that also appear in test_task),
drops steps with no right element, and writes exam/data/steps-<split>.jsonl and sample.json.
`html` reads exam/data/sample.json, fetches the heavy
columns only from the files that hold sampled rows, and turns each page into a list of
described elements (role/label like extension/content.js) in exam/data/pages-<split>.jsonl.
Test-split rows stay in exam/data/; never print or commit them.
"""
import json
import os
import random
import sys

import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
BASE = 'hf://datasets/osunlp/Multimodal-Mind2Web/data'
SPLITS = ['train', 'test_task', 'test_website', 'test_domain']
META_COLS = ('annotation_id, action_uid, confirmed_task, website, domain, subdomain, '
             'operation, pos_candidates, action_reprs, target_action_index')


def pull_meta(con):
    for split in SPLITS:
        out = os.path.join(DATA, f'meta-{split}.parquet')
        if os.path.exists(out):
            continue
        con.sql(f"COPY (SELECT {META_COLS}, filename FROM read_parquet('{BASE}/{split}-*.parquet', filename=true)) "
                f"TO '{out}' (FORMAT parquet)")
        n = con.sql(f"SELECT count(*) FROM '{out}'").fetchall()[0][0]
        print(f'{split}: {n} steps', file=sys.stderr)


SEED = 20261024
TARGET = {'train': 400, 'test_task': 200, 'test_website': 200, 'test_domain': 200}


def pick_tasks(steps, target, rng):
    """Whole tasks, round-robin over shuffled sites, until `target` steps (last task cut to fit)."""
    by_site = {}
    for s in steps:
        by_site.setdefault(s['website'], {}).setdefault(s['annotation_id'], []).append(s)
    sites = sorted(by_site)
    rng.shuffle(sites)
    queues = {}
    for site in sites:
        tasks = sorted(by_site[site])
        rng.shuffle(tasks)
        queues[site] = tasks
    picked = []
    while len(picked) < target and any(queues.values()):
        for site in sites:
            if not queues[site] or len(picked) >= target:
                continue
            task = by_site[site][queues[site].pop()]
            task.sort(key=lambda s: int(s['target_action_index']))
            picked.extend(task[:target - len(picked)])
    return picked


def sample(con):
    known = {r[0] for r in con.sql(f"SELECT DISTINCT website FROM '{DATA}/meta-test_task.parquet'").fetchall()}
    out = {}
    for split in SPLITS:
        rel = con.sql(f"SELECT {META_COLS} FROM '{DATA}/meta-{split}.parquet' WHERE len(pos_candidates) > 0")
        cols = rel.columns
        steps = [dict(zip(cols, row)) for row in rel.fetchall()]
        if split == 'train':
            steps = [s for s in steps if s['website'] in known]
        picked = pick_tasks(steps, TARGET[split], random.Random(f'{SEED}-{split}'))
        with open(os.path.join(DATA, f'steps-{split}.jsonl'), 'w') as f:
            for s in picked:
                s['operation'] = json.loads(s['operation'])
                s['pos_candidates'] = [json.loads(p)['backend_node_id'] for p in s['pos_candidates']]
                f.write(json.dumps(s) + '\n')
        out[split] = [s['action_uid'] for s in picked]
        print(f"{split}: {len(picked)} steps, {len({s['annotation_id'] for s in picked})} tasks, "
              f"{len({s['website'] for s in picked})} sites", file=sys.stderr)
    with open(os.path.join(DATA, 'sample.json'), 'w') as f:
        json.dump(out, f)


def pull_html(con):
    sys.path.insert(0, HERE)
    from describe import describe_page
    with open(os.path.join(DATA, 'sample.json')) as f:
        sample = json.load(f)
    for split, uids in sample.items():
        out = os.path.join(DATA, f'pages-{split}.jsonl')
        done = set()
        if os.path.exists(out):
            with open(out) as f:
                done = {json.loads(line)['action_uid'] for line in f}
        todo = [u for u in uids if u not in done]
        if not todo:
            continue
        meta = os.path.join(DATA, f'meta-{split}.parquet')
        con.execute('CREATE OR REPLACE TEMP TABLE want(uid VARCHAR)')
        con.executemany('INSERT INTO want VALUES (?)', [[u] for u in todo])
        files = [r[0] for r in con.sql(f"SELECT DISTINCT filename FROM '{meta}' WHERE action_uid IN (SELECT uid FROM want)").fetchall()]
        with open(out, 'a') as f:
            for file in files:
                rows = con.sql(f"SELECT action_uid, cleaned_html, pos_candidates, neg_candidates FROM read_parquet('{file}') "
                               f"WHERE action_uid IN (SELECT uid FROM want)").fetchall()
                for uid, html, pos, neg in rows:
                    page = describe_page(html or '', [json.loads(p) for p in pos or []], [json.loads(n) for n in neg or []])
                    f.write(json.dumps({'action_uid': uid, **page}) + '\n')
                print(f'{split}: {os.path.basename(file)} {len(rows)} pages', file=sys.stderr)


if __name__ == '__main__':
    os.makedirs(DATA, exist_ok=True)
    con = duckdb.connect()
    {'meta': pull_meta, 'sample': sample, 'html': pull_html}[sys.argv[1]](con)
