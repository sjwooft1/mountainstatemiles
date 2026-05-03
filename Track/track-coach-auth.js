/**
 * Shared Track coach gate. Coaches may sign in via coach-login.html, or reuse
 * an active Track admin session (same localStorage flag as admin.html).
 */
(function () {
  var COACH_KEY = "msm_track_coach_signed_in";
  var ADMIN_LS_KEY = "\u0074\u0020\u0072\u0020\u0061\u0020\u0063\u0020\u006b\u0020\u0061\u0020\u0064\u0020\u006d\u0020\u0069\u0020\u006e";
  var ADMIN_LS_VAL = "\u0074\u0020\u0072\u0020\u0075\u0020\u0065";

  function coachOnlySession() {
    try {
      return window.localStorage.getItem(COACH_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function adminSession() {
    try {
      return window.localStorage.getItem(ADMIN_LS_KEY) === ADMIN_LS_VAL;
    } catch (e) {
      return false;
    }
  }

  function isSignedIn() {
    return coachOnlySession() || adminSession();
  }

  function signOutCoachOnly() {
    try {
      window.localStorage.removeItem(COACH_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  window.MSMTrackCoachAuth = {
    isSignedIn,
    coachOnlySession,
    adminSession,
    signOutCoachOnly,
    COACH_KEY,
  };

  /** Build analytics preset links (paths relative to /Track/). */
  window.MSMCoachReportUrls = {
    teamAnalytics: function (schoolName) {
      var s = encodeURIComponent(schoolName || "");
      return (
        "analytics.html?schoolName=" +
        s +
        "&coachSchoolName=" +
        s
      );
    },
    meetAnalytics: function (meetId) {
      return "analytics.html?meetId=" + encodeURIComponent(meetId || "");
    },
    athleteAnalytics: function (athleteName, schoolName) {
      var qs = [];
      if (schoolName)
        qs.push("schoolName=" + encodeURIComponent(schoolName));
      if (athleteName)
        qs.push(
          "athleteName=" + encodeURIComponent(athleteName),
          "coachAthleteName=" + encodeURIComponent(athleteName),
        );
      return "analytics.html" + (qs.length ? "?" + qs.join("&") : "");
    },
  };
})();
