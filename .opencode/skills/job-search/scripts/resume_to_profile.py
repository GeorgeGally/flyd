#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple


SECTION_HEADERS = {
    "summary",
    "profile",
    "objective",
    "skills",
    "technical skills",
    "experience",
    "work experience",
    "employment",
    "projects",
    "selected projects",
    "education",
    "publications",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a draft candidate profile from a resume PDF.")
    parser.add_argument("--resume", required=True, help="Resume PDF, TXT, or Markdown file.")
    parser.add_argument("--out", required=True, help="Output candidate_profile.json path.")
    parser.add_argument("--text-out", default="", help="Optional path to save extracted resume text for review.")
    args = parser.parse_args()

    resume = Path(args.resume).expanduser().resolve()
    text, extraction_notes = extract_resume_text(resume)
    profile = build_profile(text, resume, extraction_notes)

    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(profile, indent=2, ensure_ascii=False), encoding="utf-8")

    if args.text_out:
        text_output = Path(args.text_out)
        text_output.parent.mkdir(parents=True, exist_ok=True)
        text_output.write_text(text, encoding="utf-8")

    print(f"Wrote {output}")
    if profile.get("metadata", {}).get("review_notes"):
        print("Review notes:")
        for note in profile["metadata"]["review_notes"]:
            print(f"- {note}")
    return 0


def extract_resume_text(path: Path) -> Tuple[str, List[str]]:
    if not path.exists():
        raise FileNotFoundError(f"Resume file not found: {path}")
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md", ".markdown"}:
        return normalize_text(path.read_text(encoding="utf-8")), ["Read plain-text resume."]
    if suffix != ".pdf":
        raise ValueError("Unsupported resume format. Use a PDF, TXT, or Markdown file.")

    notes: List[str] = []
    text = extract_with_pdftotext(path)
    if text.strip():
        notes.append("Extracted PDF text with pdftotext.")
        return normalize_text(text), notes

    text = extract_with_python_pdf(path)
    if text.strip():
        notes.append("Extracted PDF text with a Python PDF library.")
        return normalize_text(text), notes

    raise RuntimeError(
        "Could not extract text from the resume PDF. Install poppler/pdftotext, install pypdf, "
        "or provide a text-exported resume."
    )


def extract_with_pdftotext(path: Path) -> str:
    if not shutil.which("pdftotext"):
        return ""
    result = subprocess.run(
        ["pdftotext", "-layout", str(path), "-"],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.stdout if result.returncode == 0 else ""


def extract_with_python_pdf(path: Path) -> str:
    for module_name in ("pypdf", "PyPDF2"):
        try:
            module = __import__(module_name)
        except Exception:
            continue
        try:
            reader = module.PdfReader(str(path))
            pages = [page.extract_text() or "" for page in reader.pages]
            return "\n".join(pages)
        except Exception:
            continue
    return ""


def normalize_text(text: str) -> str:
    text = text.replace("\x00", " ").replace("\f", "\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def build_profile(text: str, resume_path: Path, extraction_notes: List[str]) -> Dict[str, Any]:
    lines = text.splitlines()
    email = first_match(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", text, re.I)
    phone = first_match(r"(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}", text)
    links = extract_links(text)
    full_name = infer_name(lines, email)
    sections = split_sections(lines)

    summary = first_section_sentence(sections, ("summary", "profile", "objective"))
    skills = extract_skills(sections)
    projects = extract_named_items(sections, ("projects", "selected projects"), "project")
    experiences = extract_named_items(sections, ("experience", "work experience", "employment"), "experience")

    review_notes = list(extraction_notes)
    if not full_name:
        review_notes.append("Name was not detected confidently.")
    if not email:
        review_notes.append("Email was not detected.")
    if not phone:
        review_notes.append("Phone number was not detected.")
    if not skills:
        review_notes.append("Skills were not detected; add important skills manually.")
    if not experiences and not projects:
        review_notes.append("Experience/project sections were not detected; add relevant evidence manually.")

    return {
        "identity": {
            "full_name": full_name,
            "email": email,
            "phone": phone,
            "current_location": "",
        },
        "resume_path": str(resume_path),
        "links": links,
        "preferences": {},
        "self_identification": {},
        "background": {
            "one_line": summary,
            "target_roles": [],
            "target_domains": [],
            "skills": skills,
        },
        "projects": projects,
        "experiences": experiences,
        "metadata": {
            "source": "resume_to_profile.py",
            "review_required": True,
            "review_notes": review_notes,
        },
    }


def first_match(pattern: str, text: str, flags: int = 0) -> str:
    match = re.search(pattern, text, flags)
    return match.group(0).strip() if match else ""


def infer_name(lines: Iterable[str], email: str) -> str:
    email_user = email.split("@", 1)[0].lower() if email else ""
    for raw in list(lines)[:12]:
        line = clean_line(raw)
        if not line or "@" in line or "http" in line.lower():
            continue
        if re.search(r"\d", line) or any(char in line for char in ("|", "/", "\\")):
            continue
        words = [word for word in re.split(r"\s+", line) if word]
        if 2 <= len(words) <= 5 and all(re.search(r"[A-Za-z]", word) for word in words):
            if email_user and any(word.lower() in email_user for word in words):
                return line
            if line == line.upper() or all(word[:1].isupper() for word in words):
                return line.title() if line == line.upper() else line
    return ""


def clean_line(line: str) -> str:
    return re.sub(r"\s+", " ", line).strip(" -•\t")


def extract_links(text: str) -> Dict[str, str]:
    raw_urls = re.findall(r"https?://[^\s),>]+|(?:www\.)[^\s),>]+", text, re.I)
    urls = [url if url.startswith("http") else f"https://{url}" for url in raw_urls]
    links = {
        "website": "",
        "linkedin": "",
        "github": "",
        "google_scholar": "",
    }
    for url in urls:
        lowered = url.lower()
        if "linkedin.com" in lowered and not links["linkedin"]:
            links["linkedin"] = url
        elif "github.com" in lowered and not links["github"]:
            links["github"] = url
        elif "scholar.google" in lowered and not links["google_scholar"]:
            links["google_scholar"] = url
        elif not links["website"]:
            links["website"] = url
    return links


def split_sections(lines: List[str]) -> Dict[str, List[str]]:
    sections: Dict[str, List[str]] = {"top": []}
    current = "top"
    for line in lines:
        cleaned = clean_line(line)
        if not cleaned:
            continue
        header = normalize_header(cleaned)
        if header in SECTION_HEADERS:
            current = header
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(cleaned)
    return sections


def normalize_header(line: str) -> str:
    stripped = re.sub(r"[:\-]+$", "", line).strip().lower()
    if len(stripped.split()) > 3:
        return ""
    return stripped


def first_section_sentence(sections: Dict[str, List[str]], names: Tuple[str, ...]) -> str:
    for name in names:
        text = " ".join(sections.get(name, [])[:4]).strip()
        if text:
            sentence = re.split(r"(?<=[.!?])\s+", text)[0]
            return sentence[:280].rstrip(" ,;")
    return ""


def extract_skills(sections: Dict[str, List[str]]) -> List[str]:
    skills_text = " ".join(sections.get("skills", []) + sections.get("technical skills", []))
    if not skills_text:
        return []
    raw = re.split(r"[,;|•]|\s{2,}", skills_text)
    skills: List[str] = []
    for item in raw:
        value = clean_line(re.sub(r"^[A-Za-z /&+-]{2,25}:\s*", "", item))
        if 2 <= len(value) <= 40 and not value.lower().startswith(("course", "award")):
            skills.append(value)
    return dedupe(skills)[:30]


def extract_named_items(sections: Dict[str, List[str]], names: Tuple[str, ...], kind: str) -> List[Dict[str, str]]:
    lines: List[str] = []
    for name in names:
        lines.extend(sections.get(name, []))
    if not lines:
        return []

    chunks: List[List[str]] = []
    current: List[str] = []
    for line in lines:
        starts_new = looks_like_item_title(line) and current
        if starts_new:
            chunks.append(current)
            current = [line]
        else:
            current.append(line)
    if current:
        chunks.append(current)

    items: List[Dict[str, str]] = []
    for chunk in chunks[:8]:
        title = clean_line(chunk[0])
        details = [clean_line(line) for line in chunk[1:] if clean_line(line)]
        if not title or len(title) > 140:
            continue
        summary = " ".join(details[:3])[:500].rstrip(" ,;")
        if not summary and len(chunk) == 1:
            continue
        item: Dict[str, str] = {
            "name": title if kind == "project" else "",
            "organization": title if kind == "experience" else "",
            "role": "",
            "summary": summary,
            "keywords": [],
        }
        items.append(item)
    return items


def looks_like_item_title(line: str) -> bool:
    if len(line) > 120:
        return False
    if line.startswith(("-", "•")):
        return False
    if re.search(r"\b(19|20)\d{2}\b", line):
        return True
    words = line.split()
    return 2 <= len(words) <= 10 and sum(word[:1].isupper() for word in words) >= max(1, len(words) // 2)


def dedupe(values: Iterable[str]) -> List[str]:
    seen = set()
    output = []
    for value in values:
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        output.append(value)
    return output


if __name__ == "__main__":
    raise SystemExit(main())
