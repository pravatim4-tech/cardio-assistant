// tests.js
// Pure clinical logic functions extracted for unit testing

window.ClinicalLogic = {
    /**
     * Determines risk category based on LVEF (Left Ventricular Ejection Fraction)
     */
    evaluateLVEF: function(lvefValue) {
        if (lvefValue < 35) return 'SEVERE';
        if (lvefValue < 45) return 'MODERATE';
        if (lvefValue < 55) return 'BORDERLINE';
        return 'NORMAL';
    },

    /**
     * Determines risk category based on GLS (Global Longitudinal Strain)
     * Normal: <= -18% (more negative is better)
     */
    evaluateGLS: function(glsValue) {
        if (glsValue > -16) return 'ABNORMAL';
        if (glsValue > -18) return 'BORDERLINE';
        return 'NORMAL';
    }
};

// Simple Unit Test Runner
window.runClinicalTests = function() {
    console.log("=== Running Clinical Logic Unit Tests ===");
    let passed = 0;
    let failed = 0;

    function assertEqual(testName, actual, expected) {
        if (actual === expected) {
            console.log(`%c[PASS] ${testName}`, 'color: #10b981');
            passed++;
        } else {
            console.error(`[FAIL] ${testName} | Expected '${expected}', got '${actual}'`);
            failed++;
        }
    }

    try {
        assertEqual("LVEF 60% should be NORMAL", window.ClinicalLogic.evaluateLVEF(60), 'NORMAL');
        assertEqual("LVEF 50% should be BORDERLINE", window.ClinicalLogic.evaluateLVEF(50), 'BORDERLINE');
        assertEqual("LVEF 40% should be MODERATE", window.ClinicalLogic.evaluateLVEF(40), 'MODERATE');
        assertEqual("LVEF 30% should be SEVERE", window.ClinicalLogic.evaluateLVEF(30), 'SEVERE');

        assertEqual("GLS -20% should be NORMAL", window.ClinicalLogic.evaluateGLS(-20), 'NORMAL');
        assertEqual("GLS -17% should be BORDERLINE", window.ClinicalLogic.evaluateGLS(-17), 'BORDERLINE');
        assertEqual("GLS -10% should be ABNORMAL", window.ClinicalLogic.evaluateGLS(-10), 'ABNORMAL');
    } catch (e) {
        console.error("Test execution failed:", e);
        failed++;
    }

    console.log(`=== Tests Complete: ${passed} Passed, ${failed} Failed ===`);
    return failed === 0;
};
