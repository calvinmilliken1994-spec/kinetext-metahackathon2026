"""Local routing contract tests; these do not call Muse or simulate model results."""
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'muse-subscription.py'

class MuseSubscriptionRouteTest(unittest.TestCase):
    def test_route_strips_api_overrides_and_bounds_cli_without_fallback(self):
        self.assertTrue(SCRIPT.exists(), 'Muse subscription bridge is missing')
        spec = importlib.util.spec_from_file_location('muse_subscription', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        env = module.subscription_env({'PATH':'keep', 'META_API_KEY':'test-secret', 'MODEL_API_KEY':'test-secret', 'META_MODEL_API_KEY':'test-secret', 'META_BASE_URL':'https://wrong.invalid'})
        self.assertEqual(env, {'PATH':'keep'})
        cmd = module.command('muse.exe', 'muse-wonder-1.0', 'prompt.txt', 'workspace', 'off')
        self.assertEqual(cmd[cmd.index('--model')+1], 'muse-wonder-1.0')
        self.assertEqual(cmd[cmd.index('--max-model-steps')+1], '1')
        self.assertEqual(cmd[cmd.index('--contributor-mode')+1], 'off')
        self.assertEqual(cmd[cmd.index('--reasoning-effort')+1], 'high')
        self.assertIn('--disable-shell', cmd)
        self.assertIn('--disable-write', cmd)
        self.assertIn('--no-foreign-personal-context', cmd)
        self.assertIn('--disable-reminders', cmd)
        self.assertNotIn('--api-key-stdin', cmd)

    def test_timeout_is_bounded(self):
        spec = importlib.util.spec_from_file_location('muse_subscription', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module.timeout_seconds(None), 90)
        self.assertEqual(module.timeout_seconds(300), 300)
        for bad in (0, 29, 601, -5):
            with self.assertRaises(ValueError):
                module.timeout_seconds(bad)

    def test_success_requires_actual_model_usage_not_just_configured_label(self):
        spec = importlib.util.spec_from_file_location('muse_subscription', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertTrue(hasattr(module, 'confirmed_model'), 'Actual returned-model validation is missing')
        self.assertTrue(module.confirmed_model({'models':[{'model':'muse-wonder-1.0','calls':1}], 'completed_calls':1}, 'muse-wonder-1.0'))
        self.assertFalse(module.confirmed_model({'models':[{'model':'muse-spark-1.3','calls':1}], 'completed_calls':1}, 'muse-wonder-1.0'))
        self.assertFalse(module.confirmed_model({'models':[], 'completed_calls':0}, 'muse-wonder-1.0'))

if __name__ == '__main__':
    unittest.main()
