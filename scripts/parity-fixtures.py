import json
import sys
from pathlib import Path

from autofill_training.export_onnx import onnx_logits
from autofill_training.features import ClassifierInput, serialize_input
from autofill_training.labels import LabelMap
from autofill_training.pipeline import TOKENIZER_FILE, _source, load_context, rows_for
from autofill_training.runtime import cpu_session
from autofill_training.selective import DecisionContext, SelectivePolicy, decide_batch
from autofill_training.tokenization import encode_texts, load_tokenizer

run, artifact, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
context = load_context(run)
label_map = LabelMap.model_validate_json((artifact / "labels.json").read_bytes())
policy = SelectivePolicy.model_validate_json((artifact / "selective_policy.json").read_bytes())
manifest = json.loads((artifact / "manifest.json").read_text())
tokenizer = load_tokenizer(_source(context.run).directory / TOKENIZER_FILE, context.run.training.max_length)

train = rows_for(context.snapshot.rows, context.plan, "train")
by_country = {}
for row in train:
    by_country.setdefault(row.job_country, []).append(row)
picked = []
for country in sorted(by_country)[:12]:
    picked.extend(by_country[country][:2])
picked.extend(sorted(train, key=lambda row: -len(row.question_text))[:4])
seen: set[str] = set()
cases = []
for row in picked:
    if row.id in seen:
        continue
    seen.add(row.id)
    cases.append(
        {
            "input": {
                "questionText": row.question_text,
                "fieldType": row.field_type,
                "jobCountry": row.job_country,
            },
            "answerKind": row.answer_kind,
            "note": "train row",
        }
    )

scoped = next((entry for entry in label_map.labels if entry.country_scope is not None), None)
extra = [
    ({"questionText": "  First   Name  ", "fieldType": "TextInput", "jobCountry": "US"}, "text", "whitespace"),
    ({"questionText": "", "fieldType": "TextInput", "jobCountry": "US"}, "text", "empty question"),
    ({"questionText": "Nombre", "fieldType": "Combobox", "jobCountry": "ES"}, "choice", "spanish"),
    ({"questionText": "志望動機を教えてください", "fieldType": "TextArea", "jobCountry": "JP"}, "text", "japanese"),
    ({"questionText": "Phone number", "fieldType": "PhoneInput", "jobCountry": "US"}, "file", "shape mismatch"),
    ({"questionText": "x " * 200, "fieldType": "TextArea", "jobCountry": "GB"}, "text", "truncation"),
]
if scoped is not None:
    extra.append(
        (
            {"questionText": "Are you legally authorized to work?", "fieldType": "BooleanRadio", "jobCountry": "ZZ"},
            "boolean",
            "country mismatch candidate",
        )
    )
for value, kind, note in extra:
    cases.append({"input": value, "answerKind": kind, "note": note})

texts = [serialize_input(ClassifierInput.model_validate(case["input"])) for case in cases]
batch = encode_texts(tokenizer, texts)
logits = onnx_logits(cpu_session(artifact / "model.onnx"), tokenizer, texts)
decisions = decide_batch(
    logits,
    policy=policy,
    label_map=label_map,
    contexts=[
        DecisionContext(
            answer_kind=case["answerKind"],
            job_country=case["input"]["jobCountry"],
            unknown_question=not case["input"]["questionText"].strip(),
        )
        for case in cases
    ],
    model_version=manifest["modelVersion"],
)
payload = {
    "modelVersion": manifest["modelVersion"],
    "maxLength": context.run.training.max_length,
    "cases": [
        {
            **case,
            "text": text,
            "tokenIds": [int(value) for value, mask in zip(ids, attention) if mask],
            "logits": [round(float(value), 6) for value in row],
            "decision": json.loads(decision.model_dump_json(by_alias=True)),
        }
        for case, text, ids, attention, row, decision in zip(
            cases, texts, batch.input_ids, batch.attention_mask, logits, decisions
        )
    ],
}
out.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n")
print("cases", len(cases), "labels", len(label_map.labels))
