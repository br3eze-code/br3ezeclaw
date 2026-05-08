{
  description = "AgentOS - AI-powered MikroTik management";
  
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };
  
  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        nodejs = pkgs.nodejs_20;
        
        agentos = pkgs.buildNpmPackage {
          pname = "agentos";
          version = "1.0.0";
          src = ./.;
          
          npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; # Update with actual hash
          
          buildInputs = [ nodejs ];
          nativeBuildInputs = [ pkgs.makeWrapper ];
          
          postInstall = ''
            makeWrapper ${nodejs}/bin/node $out/bin/agentos \
              --add-flags "$out/lib/node_modules/agentos/bin/agentos.js" \
              --prefix PATH : ${pkgs.lib.makeBinPath [ nodejs ]}
          '';
          
          meta = with pkgs.lib; {
            description = "AI-powered MikroTik router management via Telegram/WhatsApp/CLI";
            homepage = "https://github.com/br3eze-code/br3ezeclaw";
            license = licenses.asl20;
            maintainers = [ "Brighton Mzacana" ];
            platforms = platforms.all;
          };
        };
      in {
        packages = {
          default = agentos;
          agentos = agentos;
        };
        
        devShells.default = pkgs.mkShell {
          buildInputs = [ nodejs pkgs.git ];
          shellHook = ''
            echo "AgentOS development environment"
            npm install
          '';
        };
      });
}
