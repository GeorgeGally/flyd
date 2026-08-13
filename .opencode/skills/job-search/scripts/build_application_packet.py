#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple


STOPWORDS = {
    "and", "or", "the", "a", "an", "to", "of", "for", "in", "on", "with", "by",
    "is", "are", "we", "you", "our", "your", "this", "that", "will", "work",
    "role", "team", "job", "experience", "skills", "build", "building",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a review-ready job application packet.")
    parser.add_argument("--profile", required=True, help="Candidate profile JSON.")
    parser.add_argument("--job-url", required=True)
    parser.add_argument("--job-title", default="")
    parser.add_argument("--company", default="")
    parser.add_argument("--job-description-file", default="")
    parser.add_argument("--job-description", default="")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    profile = load_json(args.profile)
    jd = args.job_description
    if args.job_description_file:
        jd = Path(args.job_description_file).read_text(encoding="utf-8")
    packet = build_packet(profile, args.job_url, args.job_title, args.company, jd)
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(packet, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {output}")
    print(f"why_company_role_words={len(packet['responses']['why_company_role'].split())}")
    return 0


def load_json(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def build_packet(profile: Dict[str, Any], job_url: str, job_title: str, company: str, jd: str) -> Dict[str, Any]:
    identity = profile.get("identity") or {}
    links = profile.get("links") or {}
    preferences = profile.get("preferences") or {}
    self_id = profile.get("self_identification") or {}
    first, last = split_name(str(identity.get("full_name") or identity.get("name") or ""))
    evidence = top_evidence(profile, jd, limit=5)
    job_themes = top_terms(jd, limit=10)
    why = build_why(profile, company, job_title, jd, evidence, job_themes)
    additional = build_additional(profile, evidence, job_title)
    return {
        "job": {
            "url": job_url,
            "title": job_title,
            "company": company,
            "description_excerpt": " ".join(jd.split())[:1800],
            "themes": job_themes,
        },
        "candidate": {
            "full_name": identity.get("full_name") or identity.get("name") or "",
            "first_name": first,
            "last_name": last,
            "email": identity.get("email", ""),
            "phone": identity.get("phone", ""),
            "current_location": identity.get("current_location") or identity.get("location") or "",
            "resume_path": str(Path(profile.get("resume_path", "")).expanduser()),
            "links": {
                "website": links.get("website", ""),
                "linkedin": links.get("linkedin", ""),
                "github": links.get("github", ""),
                "google_scholar": links.get("google_scholar", ""),
            },
        },
        "preferences": {
            "phone_country": preferences.get("phone_country", ""),
            "start_date": preferences.get("start_date", ""),
            "ai_policy": yes_no_or_blank(preferences.get("ai_policy")),
            "interviewed_before": yes_no_or_blank(preferences.get("interviewed_before")),
            "work_authorization": yes_no_or_blank(
                preferences.get("work_authorization", preferences.get("authorized_to_work"))
            ),
            "needs_sponsorship": yes_no_or_blank(
                preferences.get("needs_sponsorship", preferences.get("requires_sponsorship"))
            ),
            "relocation": yes_no_or_blank(preferences.get("relocation")),
            "office_25_percent": yes_no_or_blank(preferences.get("office_25_percent") or preferences.get("office_3_days")),
        },
        "self_identification": self_id,
        "responses": {
            "why_company_role": why,
            "additional_information": additional,
            "timeline": preferences.get("timeline", ""),
            "planned_work_address": preferences.get("planned_work_address") or (
                "relocating" if yes_no_or_blank(preferences.get("relocation")) == "Yes" else ""
            ),
        },
        "evidence_used": evidence,
        "review_required": True,
        "submit": False,
    }


def split_name(name: str) -> Tuple[str, str]:
    parts = [part for part in name.split() if part]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def yes_no_or_blank(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text in {"yes", "y", "true", "1"}:
        return "Yes"
    if text in {"no", "n", "false", "0"}:
        return "No"
    return ""


def top_evidence(profile: Dict[str, Any], jd: str, limit: int = 5) -> List[Dict[str, str]]:
    items: List[Dict[str, str]] = []
    background = profile.get("background") or {}
    collections = (
        ("project", profile.get("projects") or background.get("projects") or []),
        ("experience", profile.get("experiences") or background.get("experiences") or []),
    )
    for kind, collection in collections:
        for item in collection:
            highlights = item.get("highlights") or []
            if isinstance(highlights, list):
                highlights_text = ". ".join(str(value).rstrip(".") for value in highlights)
            else:
                highlights_text = str(highlights)
            text = " ".join(
                str(item.get(key, ""))
                for key in (
                    "name",
                    "organization",
                    "company",
                    "role",
                    "title",
                    "summary",
                    "description",
                    "keywords",
                    "evidence_url",
                )
            )
            text = f"{text} {highlights_text}"
            score = overlap_score(text, jd)
            summary = str(item.get("summary") or item.get("description") or highlights_text or "")
            items.append(
                {
                    "kind": kind,
                    "name": str(item.get("name") or item.get("organization") or item.get("company") or ""),
                    "role": str(item.get("role") or item.get("title") or ""),
                    "summary": summary,
                    "evidence_url": str(item.get("evidence_url") or ""),
                    "score": f"{score:.3f}",
                }
            )
    items.sort(key=lambda item: float(item["score"]), reverse=True)
    return items[:limit]


def overlap_score(left: str, right: str) -> float:
    left_tokens = set(tokens(left))
    right_tokens = set(tokens(right))
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / max(1, min(len(left_tokens), len(right_tokens)))


def tokens(text: str) -> List[str]:
    found = re.findall(r"[A-Za-z][A-Za-z0-9+#.-]*", text or "")
    normalized = []
    for token in found:
        value = token.lower().strip(".-")
        if value.endswith("s") and len(value) > 3:
            value = value[:-1]
        if value and value not in STOPWORDS:
            normalized.append(value)
    return normalized


def top_terms(text: str, limit: int = 10) -> List[str]:
    counts: Dict[str, int] = {}
    for token in tokens(text):
        if len(token) < 4:
            continue
        counts[token] = counts.get(token, 0) + 1
    return [term for term, _count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]]


def build_why(
    profile: Dict[str, Any],
    company: str,
    job_title: str,
    jd: str,
    evidence: List[Dict[str, str]],
    job_themes: List[str],
) -> str:
    background_data = profile.get("background") or {}
    background = (
        background_data.get("one_line")
        or background_data.get("summary")
        or "My work combines hands-on execution with careful problem solving"
    ).rstrip(".")
    theme_text = ", ".join(job_themes[:5]) or "the core responsibilities in this role"
    evidence_sentences = []
    for item in evidence[:3]:
        label = item["name"]
        if item["role"]:
            label = f"{item['role']} at {label}"
        if label and item["summary"]:
            evidence_sentences.append(f"{label}: {item['summary'].rstrip('.')}.")
    evidence_block = " ".join(evidence_sentences)
    domain_sentence = domain_specific_sentence(jd)
    return (
        f"I want to work on {job_title or 'this role'} at {company or 'this team'} because it matches the kind of work I have been building toward: "
        f"{domain_sentence}. The job description emphasizes {theme_text}, and I see those as concrete places where careful work can turn into useful outcomes.\n\n"
        f"{background}. {evidence_block}\n\n"
        "What attracts me most is the chance to connect concrete evidence with practical workflows. I would be excited to understand the team's goals, contribute strong execution, and iterate with stakeholders so the work is not only well built but genuinely useful in the setting where it will be used."
    )


def domain_specific_sentence(jd: str) -> str:
    lowered = jd.lower()
    if any(term in lowered for term in ("life science", "biology", "bioinformatics", "genomics", "protein", "single-cell")):
        return "making AI systems genuinely useful for scientific and computational biology workflows, where evidence quality and failure modes matter"
    if any(term in lowered for term in ("agent", "tool use", "workflow", "computer use")):
        return "building agentic systems that can use tools, recover from failures, and be evaluated through concrete execution traces"
    if any(term in lowered for term in ("post-training", "rlhf", "reward", "sft", "eval")):
        return "turning model behavior, post-training data, and evaluation evidence into more reliable capabilities"
    if any(term in lowered for term in ("customer", "user", "product", "growth", "sales", "market")):
        return "turning customer needs and product goals into clear, useful execution"
    if any(term in lowered for term in ("data", "analytics", "dashboard", "metrics", "insight")):
        return "turning data, measurement, and operational context into better decisions"
    return "turning ambiguous responsibilities into concrete, reliable work"


def build_additional(profile: Dict[str, Any], evidence: List[Dict[str, str]], job_title: str) -> str:
    snippets = []
    for item in evidence[:5]:
        if item["name"] and item["summary"]:
            snippets.append(f"{item['name']}: {item['summary'].rstrip('.')}")
    if not snippets:
        return "I would be happy to share more detail on the projects and experiences most relevant to this role."
    return (
        f"Closest fit for {job_title or 'this role'}: "
        + "; ".join(snippets)
        + ". I would be most useful on problems that turn the role's workflows into concrete outcomes, reliable systems, and measurable progress."
    )


if __name__ == "__main__":
    raise SystemExit(main())
