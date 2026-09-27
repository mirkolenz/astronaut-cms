{
  mkShell,
  lib,
  treefmt,
  nodejs,
  oxlint,
}:
mkShell {
  shellHook = ''
    if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
      ${lib.getExe' nodejs "npm"} install
    fi
  '';
  packages = [
    nodejs
    oxlint
    treefmt
  ];
}
