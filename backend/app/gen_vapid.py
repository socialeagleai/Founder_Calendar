"""Generate a VAPID keypair for Web Push.

    python -m app.gen_vapid

Prints two lines to paste into .env (and into /root/Founder_Calendar/.env on the
VPS). The private key is a secret and must never be committed.

Rotating the pair invalidates every existing browser subscription - everyone has
to switch push back on - so generate once and keep it.
"""

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def _b64(raw: bytes) -> str:
    """base64url without padding, which is what the Push API and py-vapid want."""
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def main() -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    print(f"VAPID_PUBLIC_KEY={_b64(public)}")
    print(f"VAPID_PRIVATE_KEY={_b64(private)}")


if __name__ == "__main__":
    main()
