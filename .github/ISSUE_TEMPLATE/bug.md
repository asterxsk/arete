name: Bug report
description: Report a problem with an Arete extension
title: "[Bug] <short description>"
labels: ["bug", "triage"]
body:
  - type: dropdown
    id: extension
    attributes:
      label: Affected extension
      options:
        - header
        - todo
        - artifacts
        - pi-hermes-memory
        - subagents
        - goal
        - other
    validations:
      required: true
  - type: textarea
    id: what
    attributes:
      label: What happened?
      description: A clear and concise description of the bug.
    validations:
      required: true
  - type: textarea
    id: reproduce
    attributes:
      label: Steps to reproduce
      placeholder: |
        1. Run `/command`
        2. ...
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: Relevant logs / error output
      render: shell
