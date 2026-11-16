import unittest,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class PolicyTests(unittest.TestCase):
    def test_hosted_page_allows_only_same_origin_scripts_styles_and_api(self):
        html=(ROOT/'private/cabinet.html').read_text(encoding='utf-8')
        policy=re.search(r'<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"',html).group(1)
        self.assertIn("connect-src 'self'",policy)
        self.assertIn("script-src 'self' 'unsafe-inline'",policy)
        self.assertNotIn("connect-src 'none'",policy)
        self.assertNotIn('https:',policy)
        self.assertFalse((ROOT/'public/cabinet.html').exists())
