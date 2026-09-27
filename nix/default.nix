{ inputs, ... }:
{
  imports = [
    inputs.treefmt-nix.flakeModule
  ];
  systems = [
    "aarch64-darwin"
    "aarch64-linux"
    "x86_64-linux"
  ];

  perSystem =
    {
      pkgs,
      config,
      ...
    }:
    let
      site = pkgs.callPackage ./site.nix { };
    in
    {
      packages = {
        docs = site { workspace = "docs"; };
        demo = site { workspace = "demo"; };
        release-env = pkgs.buildEnv {
          name = "release-env";
          paths = [ pkgs.nodejs ];
        };
      };
      checks = {
        inherit (config.packages) docs demo;
      }
      // pkgs.callPackages ./ci.nix { };
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
