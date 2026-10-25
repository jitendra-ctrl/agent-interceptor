/**
 * Agent action find_opportunity for the Opportunity_Assistant agent.
 * Read-only: looks up Opportunities by name for the running user.
 *
 * Wired in Opportunity_Assistant.agent as target "apex://OpportunityAssistantFind".
 * @InvocableVariable names must match the .agent action inputs/outputs exactly.
 */
public with sharing class OpportunityAssistantFind {
    @TestVisible
    private static final Integer MAX_CANDIDATES = 5;
    private static final Integer QUERY_LIMIT = 1000;

    @InvocableMethod(
        label='Find Opportunity'
        description='Finds Opportunities whose name matches the given name. Returns the single match, or a list of candidates when several match.'
    )
    public static List<Result> execute(List<Request> requests) {
        // Bulkification: one query for every requested name.
        List<String> patterns = new List<String>();
        for (Request req : requests) {
            String name = normalise(req.opportunityName);
            if (name != null) {
                patterns.add('%' + escapeLike(name) + '%');
            }
        }

        // USER_MODE: respects the running user's sharing and field access.
        // Missing access returns zero rows without an error.
        List<Opportunity> found = new List<Opportunity>();
        if (!patterns.isEmpty()) {
            found = [
                SELECT Id, Name, StageName, CloseDate, Amount
                FROM Opportunity
                WHERE Name LIKE :patterns
                WITH USER_MODE
                ORDER BY Name
                LIMIT :QUERY_LIMIT
            ];
        }

        List<Result> results = new List<Result>();
        for (Request req : requests) {
            results.add(resultFor(normalise(req.opportunityName), found));
        }
        return results;
    }

    private static Result resultFor(String name, List<Opportunity> found) {
        if (name == null) {
            return noMatch('Please provide an opportunity name.');
        }
        List<Opportunity> exact = new List<Opportunity>();
        List<Opportunity> contains = new List<Opportunity>();
        String lowered = name.toLowerCase();
        for (Opportunity opp : found) {
            String oppName = opp.Name.toLowerCase();
            if (oppName == lowered) {
                exact.add(opp);
            } else if (oppName.contains(lowered)) {
                contains.add(opp);
            }
        }

        // Exact name matches win over partial matches.
        List<Opportunity> matches = exact.isEmpty() ? contains : exact;
        if (matches.isEmpty()) {
            return noMatch('No opportunity matching "' + name + '" was found.');
        }
        if (matches.size() == 1) {
            return singleMatch(matches[0]);
        }
        return candidates(name, matches);
    }

    private static Result noMatch(String message) {
        Result r = new Result();
        r.matchCount = 0;
        r.opportunityId = '';
        r.candidates = '';
        r.message = message;
        return r;
    }

    private static Result singleMatch(Opportunity opp) {
        Result r = new Result();
        r.matchCount = 1;
        r.opportunityId = opp.Id;
        r.opportunityName = opp.Name;
        r.stageName = opp.StageName;
        r.closeDate = opp.CloseDate;
        r.amount = opp.Amount;
        r.candidates = '';
        r.message = 'Found opportunity "' + opp.Name + '" in stage ' + opp.StageName + '.';
        return r;
    }

    private static Result candidates(String name, List<Opportunity> matches) {
        List<String> lines = new List<String>();
        for (Integer i = 0; i < matches.size() && i < MAX_CANDIDATES; i++) {
            Opportunity opp = matches[i];
            lines.add(opp.Name + ' (' + opp.StageName + ', close ' + String.valueOf(opp.CloseDate) + ')');
        }
        Integer more = matches.size() - lines.size();
        if (more > 0) {
            lines.add('and ' + more + ' more');
        }

        Result r = new Result();
        r.matchCount = matches.size();
        r.opportunityId = '';
        r.candidates = String.join(lines, '\n');
        r.message = matches.size() + ' opportunities match "' + name + '". Ask which one is meant.';
        return r;
    }

    private static String normalise(String value) {
        return String.isBlank(value) ? null : value.trim();
    }

    // Treat % and _ typed by the user as literal characters, not LIKE wildcards.
    @TestVisible
    private static String escapeLike(String value) {
        return value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_');
    }

    public class Request {
        @InvocableVariable(
            label='Opportunity Name'
            description='Full or partial name of the opportunity to find'
            required=true
        )
        public String opportunityName;
    }

    public class Result {
        @InvocableVariable(
            label='Match Count'
            description='Number of opportunities that match the name (0, 1, or more)'
        )
        public Integer matchCount;

        @InvocableVariable(
            label='Opportunity ID'
            description='ID of the matching opportunity when exactly one matches; empty otherwise'
        )
        public String opportunityId;

        @InvocableVariable(
            label='Opportunity Name'
            description='Name of the matching opportunity when exactly one matches'
        )
        public String opportunityName;

        @InvocableVariable(
            label='Stage'
            description='Current stage of the matching opportunity when exactly one matches'
        )
        public String stageName;

        @InvocableVariable(
            label='Close Date'
            description='Close date of the matching opportunity when exactly one matches'
        )
        public Date closeDate;

        @InvocableVariable(
            label='Amount'
            description='Amount of the matching opportunity when exactly one matches; may be empty'
        )
        public Decimal amount;

        @InvocableVariable(
            label='Candidates'
            description='One line per matching opportunity when several match: name, stage and close date'
        )
        public String candidates;

        @InvocableVariable(
            label='Message'
            description='Plain-language summary of the search result'
        )
        public String message;
    }
}
