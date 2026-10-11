{ pkgs
, lib ? pkgs.lib
, version ? "0.1.0-dev"
, buildRevision ? "unknown"
, buildDirty ? false
, packageSrc ? lib.cleanSource ./..
}:

let
  nodejs = pkgs.nodejs_22;
  pnpm = pkgs.pnpm_9;
  buildInfo = builtins.toJSON {
    inherit version;
    revision = buildRevision;
    dirty = buildDirty;
    source = "nix";
  };
in
pkgs.stdenv.mkDerivation {
  pname = "linear-gsuite";
  version = version;
  src = packageSrc;

  nativeBuildInputs = [
    nodejs
    pnpm
    pkgs.pnpmConfigHook
    pkgs.makeWrapper
  ];

  pnpmDeps = pkgs.fetchPnpmDeps {
    pname = "linear-gsuite";
    inherit version;
    src = packageSrc;
    inherit pnpm;
    fetcherVersion = 3;
    hash = "sha256-lF4VlenLvhFN2vaIZ9YNkq9EV63wP8uBAIolxGJHoVI=";
  };

  dontStrip = true;

  buildPhase = ''
    runHook preBuild
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
    pnpm build
    pnpm prune --prod --no-optional
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/bin" "$out/lib/linear-gsuite"
    cp -r dist "$out/lib/linear-gsuite/"
    cp -a node_modules "$out/lib/linear-gsuite/"
    cp package.json README.md LICENSE "$out/lib/linear-gsuite/"
    printf '%s\n' '${buildInfo}' > "$out/lib/linear-gsuite/build-info.json"
    if [ -d nix ]; then
      cp -r nix "$out/lib/linear-gsuite/"
    fi
    if [ -d examples ]; then
      cp -r examples "$out/lib/linear-gsuite/"
    fi
    makeWrapper ${nodejs}/bin/node "$out/bin/linear-gsuite" \
      --add-flags "$out/lib/linear-gsuite/dist/cli.js"
    runHook postInstall
  '';

  passthru = {
    homeManagerModule = ./modules/home-manager.nix;
  };

  meta = with lib; {
    description = "Linear and Google Workspace automation toolkit";
    homepage = "https://github.com/tinyland-inc/linear-gsuite";
    license = licenses.mit;
    maintainers = [ ];
    platforms = platforms.unix;
    mainProgram = "linear-gsuite";
  };
}
