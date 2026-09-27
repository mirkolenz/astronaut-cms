# The CI suite, as one derivation per job rather than one script that runs them
# all: nix schedules them in parallel, caches each on its own inputs, and a
# failure re-runs only the job that failed.
{
  buildNpmPackage,
  gitMinimal,
  importNpmLock,
  oxlint,
}:
let
  job =
    {
      name,
      script,
      nativeBuildInputs ? [ ],
    }:
    buildNpmPackage (finalAttrs: {
      pname = "astronaut-cms-${name}";
      inherit (finalAttrs.npmDeps) version;
      inherit (importNpmLock) npmConfigHook;
      npmDeps = importNpmLock { npmRoot = finalAttrs.src; };

      src = ../.;
      nativeBuildInputs = [ gitMinimal ] ++ nativeBuildInputs;

      buildPhase = ''
        runHook preBuild
        ${script}
        runHook postBuild
      '';

      installPhase = ''
        runHook preInstall
        touch "$out"
        runHook postInstall
      '';
    });
in
{
  test = job {
    name = "test";
    script = "npm test";
  };

  lint = job {
    name = "lint";
    nativeBuildInputs = [ oxlint ];
    # `astro sync` writes the generated content types the type checker reads,
    # and the demo reads the package's types from `dist/`.
    script = ''
      npm run build
      npm exec --workspace demo -- astro sync
      npm exec --workspace docs -- astro sync
      oxlint --type-aware --type-check
    '';
  };

  package = job {
    name = "package";
    script = ''
      npm run build
      npm pack --dry-run --ignore-scripts
    '';
  };
}
