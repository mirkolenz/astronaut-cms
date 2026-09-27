---
title: "Building a design system that lasts"
excerpt: "Most design systems rot within a year. The ones that survive share a few unglamorous habits."
publishDate: 2026-04-02
author: marcus
cover: /src/assets/cover-design-system.svg
category: Engineering
featured: false
---

A design system is easy to start and hard to keep.
The first version is always clean, because nobody has needed to break it yet.
The real test is what it looks like after a year of shipping under pressure.

Here is what we have learned keeps a system alive.

## Tokens before components

Colours, spacing, and type belong in one place, expressed as tokens.
Components should reference those tokens and never hard-code a value.

When a brand shifts, you change a handful of tokens and the whole product follows.
When values are scattered across components, every change becomes an archaeology project.

## One component, one job

A component that tries to handle every case becomes impossible to reason about.
We keep each one narrow and compose them instead.

- A button is a button, not a button that is sometimes a link and sometimes a menu.
- A card lays out content; it does not fetch it.
- Layout primitives handle spacing so components do not have to.

## Accessibility is not a phase

The cheapest time to get contrast, focus states, and semantics right is the first time.
Retrofitting accessibility onto a mature system is slow and demoralising.

We treat the accessible version as the only version.
There is no separate track to fall behind.

## Document the why, not just the what

Anyone can read the code to see what a component does.
What they cannot recover is why it works that way.

A short note on each decision saves the next person a week of guessing, and saves the system from being quietly undone.
