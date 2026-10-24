"""Describe a Mind2Web page the way Show Me's content script does (extension/content.js).

Each candidate element becomes {bid, tag, role, label, ...}: role and label follow roleOf() and
labelOf() in content.js, using the node in cleaned_html for its text and the candidate's own
attributes. Elements come back in page order; `text` is the page's visible text.
"""
import json
import re

from lxml import html as lxml_html

CONTROL_TAGS = {'a', 'button', 'input', 'select', 'textarea', 'option', 'label', 'summary'}
CONTROL_ROLES = {'button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option', 'switch',
                 'combobox', 'textbox', 'searchbox', 'listbox', 'menuitemcheckbox', 'menuitemradio'}


def clean(s, limit=80):
    return re.sub(r'\s+', ' ', str(s or '')).strip()[:limit]


def attrs_of(candidate):
    a = candidate.get('attributes') or {}
    return json.loads(a) if isinstance(a, str) else a


def role_of(tag, a):
    if a.get('role'):
        return a['role']
    if tag == 'a':
        return 'link'
    if tag in ('button', 'summary'):
        return 'button'
    if tag == 'select':
        return 'select'
    if tag == 'textarea' or a.get('contenteditable') in ('', 'true'):
        return 'textbox'
    if tag == 'input':
        kind = (a.get('type') or 'text').lower()
        if kind in ('checkbox', 'radio'):
            return kind
        if kind in ('submit', 'button', 'reset', 'image'):
            return 'button'
        return 'textbox'
    return tag


def label_of(tag, a, node, labels_by_for):
    """Returns (label, named): named is False when only the tag name was left."""
    aria = clean(a.get('aria_label') or a.get('aria-label'))
    if aria:
        return aria, True
    if a.get('id') and labels_by_for.get(a['id']):
        return clean(labels_by_for[a['id']]), True
    if tag == 'input' and (a.get('type') or '').lower() in ('submit', 'button', 'reset') and clean(a.get('value')):
        return clean(a.get('value')), True
    if tag not in ('select', 'textarea', 'input') and node is not None:
        text = clean(node.text_content())
        if text:
            return text, True
    for key in ('placeholder', 'title', 'name', 'id'):
        if clean(a.get(key)):
            return clean(a[key]), True
    return tag, False


def describe_page(cleaned_html, pos, neg):
    doc = None
    if cleaned_html.strip():
        try:
            doc = lxml_html.fromstring(cleaned_html)
        except Exception:
            doc = None
    nodes, order, labels_by_for = {}, {}, {}
    text = ''
    if doc is not None:
        for i, el in enumerate(doc.iter()):
            if not isinstance(el.tag, str):
                continue
            bid = el.get('backend_node_id')
            if bid is not None:
                nodes[bid] = el
                order[bid] = i
            if el.tag == 'label' and el.get('for'):
                labels_by_for[el.get('for')] = el.text_content()
        text = clean(doc.text_content(), 2000)
    elements = []
    seen = set()
    for is_pos, group in ((True, pos), (False, neg)):
        for c in group:
            bid = str(c.get('backend_node_id'))
            if bid in seen:
                continue
            seen.add(bid)
            a = attrs_of(c)
            node = nodes.get(bid)
            tag = (c.get('tag') or (node.tag if node is not None else '') or '').lower()
            role = role_of(tag, a)
            label, named = label_of(tag, a, node, labels_by_for)
            item = {'bid': bid, 'tag': tag, 'role': role, 'label': label, 'pos': is_pos,
                    'order': order.get(bid, 10 ** 9),
                    'control': named and (tag in CONTROL_TAGS or role in CONTROL_ROLES)}
            if role == 'select' and node is not None:
                item['options'] = [clean(o.text_content(), 30) for o in node.iter('option') if clean(o.text_content())]
            elif role in ('textbox', 'combobox', 'searchbox') and clean(a.get('input_value'), 60):
                item['value'] = clean(a.get('input_value'), 60)
            elements.append(item)
    elements.sort(key=lambda e: e['order'])
    return {'text': text, 'elements': elements}
