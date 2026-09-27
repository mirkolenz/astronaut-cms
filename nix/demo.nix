{
  buildNpmPackage,
  importNpmLock,
}:
buildNpmPackage (finalAttrs: {
  pname = "astronaut-cms-demo";
  inherit (finalAttrs.npmDeps) version;
  inherit (importNpmLock) npmConfigHook;
  npmDeps = importNpmLock { npmRoot = finalAttrs.src; };

  src = ../.;

  npmBuildFlags = [
    "--workspace"
    "demo"
    "--include-workspace-root"
  ];

  installPhase = ''
    runHook preInstall

    mkdir -p "$out"
    cp -r "demo/dist/." "$out"

    runHook postInstall
  '';
})
