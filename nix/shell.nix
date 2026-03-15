{
  mkShell,
  lib,
  treefmt,
  nodejs,
}:
mkShell {
  shellHook = ''
    if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
      ${lib.getExe' nodejs "npm"} install
    fi
  '';
  packages = [
    nodejs
    treefmt
  ];
}
