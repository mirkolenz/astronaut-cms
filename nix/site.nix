# The two static sites this repo builds. They differ only in the workspace npm
# builds and what the CMS integration targets, so they share one derivation.
{
  buildNpmPackage,
  importNpmLock,
}:
{ workspace }:
buildNpmPackage (finalAttrs: {
  pname = "astronaut-cms-${workspace}";
  inherit (finalAttrs.npmDeps) version;
  inherit (importNpmLock) npmConfigHook;
  npmDeps = importNpmLock { npmRoot = finalAttrs.src; };

  src = ../.;

  npmBuildFlags = [
    "--workspace"
    workspace
  ];

  installPhase = ''
    runHook preInstall

    mkdir -p "$out"
    cp -r "${workspace}/dist/." "$out"

    runHook postInstall
  '';
})
