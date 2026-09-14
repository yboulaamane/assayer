Network pharmacology workflow

The `network-pharmacology` recipe supports compound-set and plant-versus-disease
studies. Both the keyword router and the server's allowed model routes include
it. The original Aloysia–Parkinson's request works without a provider. Explicit
network-study wording takes precedence over incidental screening keywords.

The original question is retained in the scope step and Markdown export. A plant
or disease is never used as the single protein for live structure lookup on this
route. Botanical species, preparation and host organism must be confirmed in the
scope gate; the planner does not infer a particular Aloysia species or fabricate
constituents. This remains a research plan: it does not retrieve constituent lists
or execute network analysis.

Eight modules cover scope, constituent provenance, compound-target evidence,
disease-target evidence, networks, enrichment, prioritisation and validation.
Each declares its inputs and outputs for composition and validation. Tools are
existing catalogue entries. No mandatory docking or MD step is added.

Method references checked when authoring the workflow:

- [SwissTargetPrediction input documentation](https://www.swisstargetprediction.ch/help.php)
  specifies molecular structures and the protein target species as inputs.
- [STRING API documentation](https://en.string-db.org/help/api/)
  documents identifier mapping, species, evidence channels, network expansion,
  versioned queries, enrichment background and false discovery rates.

Regression coverage includes the reported prompt, alternate spellings, overlapping
screening terms, unavailable semantic routing, erroneous model target fields,
unrelated unsupported prompts, rendered content and copied Markdown. Existing
registry-wide composition tests also exercise the added recipe under exclusions.
