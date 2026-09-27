{ inputs, ... }:
{
  imports = [
    inputs.treefmt-nix.flakeModule
  ];
  systems = import inputs.systems;

  perSystem =
    {
      pkgs,
      config,
      ...
    }:
    {
      packages = {
        docs = pkgs.callPackage ./docs.nix { };
        demo = pkgs.callPackage ./demo.nix { };
        release-env = pkgs.buildEnv {
          name = "release-env";
          paths = [ pkgs.nodejs ];
        };
      };
      checks = {
        inherit (config.packages) docs demo;
      };
      devShells.default = pkgs.callPackage ./shell.nix {
        treefmt = config.treefmt.build.wrapper;
      };
      treefmt = {
        projectRootFile = "flake.nix";
        programs = {
          nixfmt.enable = true;
          oxfmt.enable = true;
        };
      };
    };
}
