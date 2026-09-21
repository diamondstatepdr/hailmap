#!/bin/sh
# Adds the Capacitor Android project (com.hailmap.app) and forces HTTPS-only traffic.
set -eu

if [ -n "${CAPACITOR_SERVER_URL:-}" ]; then
  case "$CAPACITOR_SERVER_URL" in
    https://*) ;;
    *)
      echo "CAPACITOR_SERVER_URL must start with https://"
      exit 1
      ;;
  esac
fi

if [ ! -d android ]; then
  npx cap add android
fi

npx cap sync android

MANIFEST="android/app/src/main/AndroidManifest.xml"
XML_DIR="android/app/src/main/res/xml"
NET_XML="$XML_DIR/network_security_config.xml"

if [ -f "$MANIFEST" ]; then
  mkdir -p "$XML_DIR"
  cat > "$NET_XML" << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
EOF
  if ! grep -q 'android:usesCleartextTraffic="false"' "$MANIFEST"; then
    sed -i 's/android:usesCleartextTraffic="true"/android:usesCleartextTraffic="false"/' "$MANIFEST" || true
  fi
  if ! grep -q "networkSecurityConfig" "$MANIFEST"; then
    sed -i 's/<application/<application android:usesCleartextTraffic="false" android:networkSecurityConfig="@xml\/network_security_config"/' "$MANIFEST"
  fi
  echo "Android project ready: com.hailmap.app (cleartext disabled)."
else
  echo "Android manifest not found after cap sync."
  exit 1
fi
