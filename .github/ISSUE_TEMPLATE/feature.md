name: Feature request
description: Suggest a new capability or extension for Arete
title: "[Feature] <short description>"
labels: ["feature", "triage"]
body:
  - type: textarea
    id: problem
    attributes:
      label: Problem or motivation
      description: What problem would this solve?
    validations:
      required: true
  - type: textarea
    id: proposal
    attributes:
      label: Proposed solution
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
    validations:
      required: false
