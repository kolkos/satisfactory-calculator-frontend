# Pinned to Angular 21 and TypeScript 5.9 to keep Optimus UI's peer range satisfiable

A greenfield project sitting a major version behind looks like neglect, so: this is deliberate. `@openng/optimus-ui@1.0.1` declares peer dependencies of `@angular/*: ^21.0.0`. Against Angular 22 that is a hard `ERESOLVE` — not a warning — on `@angular/cdk` and on `@angular/common` alike, so no combination of CDK versions rescues it. Angular 21 with TypeScript 5.9 resolves cleanly with no flags.

## Considered Options

- **`@openng/optimus-ui@2.0.0-rc.0`**, which declares `@angular/*: ^22.0.0` and installs cleanly on the current Angular. Rejected for its release-candidate status.
- **Stay on Angular 22 with `legacy-peer-deps=true` in `.npmrc`.** Demonstrably works, but the flag is repo-wide and permanent: it disables peer checking for the entire dependency tree, so npm would stay silent about every future incompatibility, not just this one.
- **Drop Optimus UI and build the surrounding UI on Tailwind 4.** No conflict to manage at all, but an accessible combobox for the part picker becomes our own problem.

## Consequences

TypeScript drops to 5.9 because `@angular/build@21` requires `>=5.9 <6.0` — stricter than `@angular/compiler-cli`, which would have allowed 6.0.

Three rules in `AGENTS.md` describe Angular v22 behaviour and become wrong here: `OnPush` is not the default before v22 and must be set explicitly, Signal Forms (`@angular/forms/signals`) are not yet stable, and the `@Service` decorator does not exist. Those rules need rewriting for v21 rather than silently ignoring.

This pin is temporary by construction. When Optimus UI 2.0 goes stable, the reason for it disappears and both Angular and TypeScript should move forward again.