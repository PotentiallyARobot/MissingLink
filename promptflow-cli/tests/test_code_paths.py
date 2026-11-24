import unittest
from promptflow_cli.runtime import normalize_code_files,RunError

class CodePaths(unittest.TestCase):
    def test_workspace_prefix_preserves_content(self):
        self.assertEqual(normalize_code_files([{'path':'/workspace/context.txt','content':'unchanged'}]),[{'path':'context.txt','content':'unchanged'}])
    def test_traversal_absolute_and_aliases_rejected(self):
        for path in ['/workspace/../x','/workspace//x','/workspace/./x','/workspace/','/etc/passwd','C:/x','../x']:
            with self.subTest(path=path),self.assertRaises(RunError): normalize_code_files([{'path':path,'content':'x'}])
        with self.assertRaises(RunError):normalize_code_files([{'path':'a','content':'x'},{'path':'/workspace/a','content':'y'}])
