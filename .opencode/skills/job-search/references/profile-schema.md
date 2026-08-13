# Candidate Profile Schema

Use this JSON shape for portable application autofill. Omit unknown optional fields instead of using placeholders.

Most users can start with only a resume PDF:

```bash
python3 scripts/resume_to_profile.py --resume /absolute/path/resume.pdf --out candidate_profile.json
```

Review the generated JSON before using it. Resume parsing is best-effort, and legal, work authorization, sponsorship, salary, relocation, and self-identification fields must come from explicit user confirmation.

```json
{
  "identity": {
    "full_name": "Casey Candidate",
    "email": "casey@example.com",
    "phone": "+1 555 0100",
    "current_location": "San Francisco, California, United States"
  },
  "resume_path": "/absolute/path/resume.pdf",
  "links": {
    "website": "https://casey.example",
    "linkedin": "https://www.linkedin.com/in/casey",
    "github": "https://github.com/casey",
    "google_scholar": "https://scholar.google.com/citations?user=..."
  },
  "preferences": {},
  "self_identification": {},
  "background": {
    "one_line": "Product-minded software engineer focused on reliable user-facing systems.",
    "target_roles": ["Software Engineer", "Product Engineer"],
    "target_domains": ["developer tools", "data products"],
    "skills": ["Python", "TypeScript", "system design"]
  },
  "projects": [
    {
      "name": "Customer Insights Dashboard",
      "summary": "Built analytics workflows that helped support and product teams track customer issues.",
      "keywords": ["analytics", "dashboards", "customer workflows"],
      "evidence_url": "https://github.com/casey/customer-insights"
    }
  ],
  "experiences": [
    {
      "organization": "Example Company",
      "role": "Software Engineer",
      "summary": "Built APIs and internal tools for cross-functional operations.",
      "keywords": ["APIs", "internal tools", "operations"]
    }
  ],
  "metadata": {
    "source": "resume_to_profile.py",
    "review_required": true,
    "review_notes": ["Review all extracted fields before autofill."]
  }
}
```

## Field Notes

- `resume_path` should be absolute when possible. The autofill script uploads exactly this file.
- Optional preference keys include `start_date`, `phone_country`, `work_authorization`, `needs_sponsorship`, `relocation`, `office_25_percent`, `ai_policy`, and `interviewed_before`.
- Yes/no preference fields should be `"Yes"` or `"No"` only when explicitly confirmed by the user.
- `self_identification` is optional. Fill only when the user has explicitly provided these values.
- `projects` and `experiences` power job-specific answer generation. Include concrete artifacts, domains, and metrics when available.
- `metadata` is optional and intended for extraction notes; the autofill script ignores it.
