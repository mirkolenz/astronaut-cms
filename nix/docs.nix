{
  buildNpmPackage,
  importNpmLock,
}:
buildNpmPackage (finalAttrs: {
  pname = "astronaut-cms-docs";
  inherit (finalAttrs.npmDeps) version;
  inherit (importNpmLock) npmConfigHook;
  npmDeps = importNpmLock { npmRoot = finalAttrs.src; };

  src = ../.;

  npmBuildFlags = [
    "--workspaces"
    "--include-workspace-root"
  ];

  installPhase = ''
    runHook preInstall

    mkdir -p "$out"
    cp -r "docs/dist/." "$out"

    runHook postInstall
  '';
})
