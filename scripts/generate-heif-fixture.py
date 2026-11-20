"""Create our own HEIC fixture from the repository's brand asset, not a remote photo.

Development-only: uv pip install --target artifacts/media-fixture-runtime pillow pillow-heif
"""
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / 'artifacts/media-fixture-runtime'))
from PIL import Image
import pillow_heif

pillow_heif.register_heif_opener()
image = Image.open(root / 'assets/brand/fish-symbol.png').convert('RGB').resize((256, 256))
image.save(root / 'tests/fixtures/fish-heic.heic', format='HEIF', quality=80)
print('Generated owned HEIC fixture: 256 x 256')
