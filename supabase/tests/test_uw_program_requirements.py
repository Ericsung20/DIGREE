import importlib.util
import unittest
from pathlib import Path


module_path = Path(__file__).parents[1] / "import-uw-program-requirements.py"
spec = importlib.util.spec_from_file_location("uw_program_requirements", module_path)
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)


class ProgramRequirementsTest(unittest.TestCase):
    def test_2023_title_and_duplicate_display_headings_match(self):
        html = """
        <a href="/archive/2023-2024/undergraduate/letters-science/computer-sciences/computer-sciences-bs/">
          <span><h3>Computer Sciences, B.S.</h3></span>
          <span><h3>Computer Sciences, B.S.</h3></span>
        </a>
        <a href="/undergraduate/letters-science/computer-sciences/computer-sciences-bs/">
          <h3>Computer Sciences, BS</h3>
        </a>
        """
        links = catalog.program_links(html, 2023)
        self.assertEqual(len(links["computer sciences, bs"]), 1)
        self.assertTrue(next(iter(links["computer sciences, bs"])).startswith("/archive/2023-2024/"))

    def test_preserves_options_but_labels_prose_references_separately(self):
        html = """
        <title>Computer Sciences, BS &lt; University of Wisconsin-Madison</title>
        <div id="requirementstextcontainer">
          <h2>Requirements for the Major</h2><h3>Probability or Statistics</h3>
          <table class="sc_courselist">
            <tr><td colspan="3">Complete one:</td></tr>
            <tr><td class="codecol"><a class="bubblelink code" href="/search/?P=STAT%20340">STAT 340</a></td>
              <td>Data Science Modeling II. Excludes <a class="bubblelink code" href="/search/?P=STAT%20303">STAT 303</a>.</td>
              <td class="hourscol">4</td></tr>
            <tr><td class="codecol orclass">or <a class="bubblelink code" href="/search/?P=MATH%20331">MATH 331</a></td></tr>
          </table>
          <p>Example: <a class="bubblelink code" href="/search/?P=COMP%20SCI%20200">COMP SCI 200</a>.</p>
        </div>
        <div id="fouryearplantextcontainer"><a class="bubblelink code" href="/search/?P=MATH%20222">MATH 222</a></div>
        """
        title, groups = catalog.extract_requirements(html)
        self.assertEqual(title, "Computer Sciences, BS")
        self.assertEqual(groups[0]["heading"], "Requirements for the Major / Probability or Statistics")
        self.assertEqual([row["kind"] for row in groups[0]["rows"]], ["criterion", "course", "alternative"])
        self.assertEqual(groups[0]["rows"][1]["courses"][0]["code"], "STAT 340")
        self.assertEqual([item["code"] for item in groups[0]["rows"][1]["references"]], ["STAT 303"])
        self.assertEqual(groups[0]["rows"][1]["credits"], "4")
        self.assertEqual(groups[1]["rows"][0]["kind"], "reference")
        self.assertEqual(len(groups), 2)

    def test_supplemental_catalog_preserves_non_course_rules_and_declaration(self):
        html = """
        <title>Teaching, Minor &lt; University of Wisconsin-Madison</title>
        <div id="howtogetintextcontainer"><h2>How to Get In</h2><p>Elementary Education students only.</p></div>
        <div id="requirementstextcontainer"><h2>Requirements</h2>
          <ul><li>Minimum GPA of 2.75.<ul><li>At least 6 credits in residence.</li></ul></li></ul>
        </div>
        """
        title, requirements = catalog.extract_requirements(html, include_conditions=True)
        self.assertEqual(title, "Teaching, Minor")
        self.assertEqual([row["label"] for group in requirements for row in group["rows"]],
                         ["Minimum GPA of 2.75.", "At least 6 credits in residence."])
        self.assertEqual(requirements[0]["rows"][1]["credit_conditions"], ["6 credits"])
        _, declaration = catalog.extract_requirements(html, include_conditions=True, section_id="howtogetintextcontainer")
        self.assertEqual(declaration[0]["rows"][0]["label"], "Elementary Education students only.")

    def test_major_preserves_prose_criteria_details_and_footnotes_together(self):
        html = """
        <title>Example, BS &lt; University of Wisconsin-Madison</title>
        <div id="requirementstextcontainer"><h2>Requirements</h2>
          <p>A minimum GPA of 2.0 is required.</p>
          <table><tr><td>Residency</td><td>Complete 30 credits at UW–Madison.</td></tr></table>
          <ul><li>Permission is required for substitutions.</li></ul>
        </div>
        """
        _, groups = catalog.extract_requirements(html, include_conditions=True)
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0]["rows"]), 3)
        self.assertIn("GPA of 2.0", groups[0]["rows"][0]["label"])
        self.assertIn("30 credits", groups[0]["rows"][1]["description"])
        self.assertIn("Permission", groups[0]["rows"][2]["label"])

    def test_long_criteria_and_unicode_are_not_truncated(self):
        rule = "Complete the required courses and obtain advisor approval. " * 4 + "UW–Madison residency applies."
        rows = catalog.table_rows(next(node for node in catalog.Document(
            f"<table><tr><td>{rule}</td><td>Minimum GPA 2.75.</td></tr></table>"
        ).root.walk() if node.tag == "table"))
        self.assertEqual(rows[0]["label"], rule)
        self.assertEqual(rows[0]["description"], "Minimum GPA 2.75.")


if __name__ == "__main__":
    unittest.main()
