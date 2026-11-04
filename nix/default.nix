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
      nodejs = pkgs.nodejs_26;
      site = pkgs.callPackage ./site.nix { inherit nodejs; };
    in
    {
      packages = {
        docs = site { workspace = "docs"; };
        demo = site { workspace = "demo"; };
        release-env = pkgs.buildEnv {
          name = "release-env";
          paths = [ nodejs ];
        };
      };
      checks = {
        inherit (config.packages) docs demo;
      }
      // pkgs.callPackages ./ci.nix { inherit nodejs; };
      devShells.default = pkgs.callPackage ./shell.nix {
        inherit nodejs;
        treefmt = config.treefmt.build.wrapper;
      };
      treefmt = {
        projectRootFile = "flake.nix";
        settings.global.excludes = [ "CHANGELOG.md" ];
        programs = {
          nixfmt.enable = true;
          oxfmt.enable = true;
        };
      };
    };
}
