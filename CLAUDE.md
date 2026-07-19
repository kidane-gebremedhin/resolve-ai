@AGENTS.md

### Always ask clarifying questions when unclear before implemention
### Humanize AI ressponses

### Unless explicitly stated, always use the current project directory as a base file path

### Always update existing specs, plans, README.md/RUNBOOK.md, etc.. to accomodate the new chages implemented, so that changes persist on brand new code regeneration from specs, plans, etc...

### Always create new CHANGELOG_[1-BASED INDEX NUMBER].md outlining only the new chages implemented (Don't outline changes from previous sessions), use the existing changelog index as base, don't consider deleted ones

### When creating new environment variable, make sure it is added to .env.example

### Do not git commit 

### Verify each new feature is working as expected and fix any issues found using devtools mcp, you may skip blocked ones that need human input. Write results into QA_TEST_RESULTS_[1-BASED INDEX NUMBER].md file.