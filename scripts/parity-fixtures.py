import json
import sys
from pathlib import Path

from autofill_training.export_onnx import onnx_logits
from autofill_training.features import ClassifierInput, serialize_input
from autofill_training.labels import LabelMap
from autofill_training.pipeline import TOKENIZER_FILE, load_context, rows_for
from autofill_training.runtime import cpu_session
from autofill_training.selective import DecisionContext, SelectivePolicy, decide_batch
from autofill_training.tokenization import encode_texts, load_tokenizer

run, artifact, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
context = load_context(run, allow_code_drift=True)
label_map = LabelMap.model_validate_json((artifact / "labels.json").read_bytes())
policy = SelectivePolicy.model_validate_json((artifact / "selective_policy.json").read_bytes())
version_file = artifact / "manifest.json"
if not version_file.is_file():
    version_file = artifact / "model-version.json"
manifest = json.loads(version_file.read_text())
tokenizer = load_tokenizer(artifact / TOKENIZER_FILE, context.run.training.max_length)

train = rows_for(context.snapshot.rows, context.plan, "train")
by_country = {}
for row in train:
    by_country.setdefault(row.job_country, []).append(row)
picked = []
for country in sorted(by_country)[:12]:
    picked.extend(by_country[country][:2])
picked.extend(sorted(train, key=lambda row: -len(row.question_text))[:4])
picked.extend(sorted((row for row in train if row.option_labels), key=lambda row: -len(row.option_labels or []))[:4])
picked.extend([row for row in train if row.option_labels][:4])
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
                "optionLabels": row.option_labels or [],
            },
            "answerKind": row.answer_kind,
            "note": "train row",
        }
    )

scoped = next((entry for entry in label_map.labels if entry.country_scope is not None), None)
def case_input(question, field_type, country, options=None):
    return {
        "questionText": question,
        "fieldType": field_type,
        "jobCountry": country,
        "optionLabels": options or [],
    }


extra = [
    (case_input("  First   Name\u00a0 ", "TextInput", "US"), "text", "whitespace"),
    (case_input("", "TextInput", "US"), "text", "empty question"),
    (case_input("Nombre", "Combobox", "ES"), "choice", "spanish"),
    (case_input("\u5fd7\u671b\u52d5\u6a5f\u3092\u6559\u3048\u3066\u304f\u3060\u3055\u3044", "TextArea", "JP"), "text", "japanese"),
    (case_input("Phone number", "PhoneInput", "US"), "file", "shape mismatch"),
    (case_input("x " * 200, "TextArea", "GB"), "text", "truncation"),
    (case_input("Degree", "Combobox", "US", ["Bachelor's", "Master's", "PhD"]), "choice", "degree with levels"),
    (case_input("Degree", "Combobox", "US", ["Computer Science", "Mathematics", "Other"]), "choice", "degree with subjects"),
    (case_input("Degree", "Combobox", "US"), "choice", "degree without options"),
    (case_input("Gender", "RadioGroup", "DE", ["  Woman ", "", "Man", "Prefer not to say"]), "choice", "blank option label"),
    (case_input("Select one", "RadioGroup", "GB", [f"Option {index}" for index in range(60)]), "choice", "option truncation"),
]
if scoped is not None:
    extra.append(
        (
            case_input("Are you legally authorized to work?", "BooleanRadio", "ZZ"),
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
