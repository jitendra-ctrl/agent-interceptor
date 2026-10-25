/**
 * Agent action update_opportunity_stage for the Opportunity_Assistant agent.
 * Changes the StageName of one Opportunity and reports the outcome truthfully:
 * every save error (validation rule, missing permission, lock, ...) is caught and
 * returned as success = false with the error text, and success is only true when
 * a re-query shows the record really holds the new stage.
 *
 * Wired in Opportunity_Assistant.agent as target "apex://OpportunityAssistantUpdateStage".
 * @InvocableVariable names must match the .agent action inputs/outputs exactly.
 */
public with sharing class OpportunityAssistantUpdateStage {
    @InvocableMethod(
        label='Update Opportunity Stage'
        description='Changes the stage of one opportunity and reports whether the change was saved, with the stage the record holds afterwards.'
    )
    public static List<Result> execute(List<Request> requests) {
        List<String> stageOrder = activeStages();
        Map<String, String> stageByLowerCase = new Map<String, String>();
        for (String stage : stageOrder) {
            stageByLowerCase.put(stage.toLowerCase(), stage);
        }

        // Bulkification: one load, one save, one re-query.
        Set<Id> ids = new Set<Id>();
        for (Request req : requests) {
            Id oppId = toId(req.opportunityId);
            if (oppId != null) {
                ids.add(oppId);
            }
        }
        Map<Id, Opportunity> before = load(ids);

        List<Result> results = new List<Result>();
        List<Opportunity> toSave = new List<Opportunity>();
        List<Integer> saveIndexes = new List<Integer>();
        for (Integer i = 0; i < requests.size(); i++) {
            Request req = requests[i];
            Result r = new Result();
            results.add(r);

            Id oppId = toId(req.opportunityId);
            Opportunity opp = oppId == null ? null : before.get(oppId);
            if (opp == null) {
                r.success = false;
                r.message = 'Opportunity not found or not accessible.';
                continue;
            }
            r.previousStage = opp.StageName;
            r.currentStage = opp.StageName;

            String stage = String.isBlank(req.newStage) ? null : stageByLowerCase.get(req.newStage.trim().toLowerCase());
            if (stage == null) {
                r.success = false;
                r.message = 'Stage "' + req.newStage + '" isn\'t valid. Valid stages: ' +
                    String.join(stageOrder, ', ') + '.';
                continue;
            }
            if (stage == opp.StageName) {
                r.success = true;
                r.message = 'The opportunity is already in stage ' + stage + '. Nothing was changed.';
                continue;
            }
            toSave.add(new Opportunity(Id = opp.Id, StageName = stage));
            saveIndexes.add(i);
        }

        if (!toSave.isEmpty()) {
            save(toSave, saveIndexes, results);
            Map<Id, Opportunity> after = load(ids);
            for (Integer k = 0; k < toSave.size(); k++) {
                confirm(results[saveIndexes[k]], toSave[k], after.get(toSave[k].Id));
            }
        }
        return results;
    }

    // Partial-success save in user mode. Errors are recorded per record, never thrown.
    private static void save(List<Opportunity> toSave, List<Integer> saveIndexes, List<Result> results) {
        List<Database.SaveResult> saveResults;
        try {
            saveResults = Database.update(toSave, false, AccessLevel.USER_MODE);
        } catch (Exception e) {
            for (Integer index : saveIndexes) {
                results[index].success = false;
                results[index].message = 'The change was not saved: ' + e.getMessage();
            }
            return;
        }
        for (Integer k = 0; k < saveResults.size(); k++) {
            Result r = results[saveIndexes[k]];
            if (saveResults[k].isSuccess()) {
                r.success = true;
            } else {
                r.success = false;
                r.message = 'The change was not saved: ' + errorText(saveResults[k].getErrors());
            }
        }
    }

    // success stays true only if the record now holds the requested stage.
    private static void confirm(Result r, Opportunity requested, Opportunity actual) {
        if (actual != null) {
            r.currentStage = actual.StageName;
        }
        if (r.success != true) {
            return;
        }
        if (actual != null && actual.StageName == requested.StageName) {
            r.message = 'Stage changed from ' + r.previousStage + ' to ' + actual.StageName + '.';
        } else {
            r.success = false;
            r.message = 'The save reported success, but the opportunity\'s stage is now ' +
                (actual == null ? 'unknown' : actual.StageName) + ', not ' + requested.StageName + '.';
        }
    }

    private static Map<Id, Opportunity> load(Set<Id> ids) {
        if (ids.isEmpty()) {
            return new Map<Id, Opportunity>();
        }
        return new Map<Id, Opportunity>([
            SELECT Id, Name, StageName
            FROM Opportunity
            WHERE Id IN :ids
            WITH USER_MODE
        ]);
    }

    // Active StageName picklist values in picklist order. Matching is case-insensitive,
    // so "closed won" is saved as "Closed Won".
    private static List<String> activeStages() {
        List<String> stages = new List<String>();
        for (Schema.PicklistEntry entry : Opportunity.StageName.getDescribe().getPicklistValues()) {
            if (entry.isActive()) {
                stages.add(entry.getValue());
            }
        }
        return stages;
    }

    private static String errorText(List<Database.Error> errors) {
        List<String> parts = new List<String>();
        for (Database.Error err : errors) {
            parts.add(err.getMessage());
        }
        return String.join(parts, '; ');
    }

    private static Id toId(String value) {
        if (String.isBlank(value)) {
            return null;
        }
        try {
            Id parsed = Id.valueOf(value.trim());
            return parsed.getSobjectType() == Opportunity.SObjectType ? parsed : null;
        } catch (StringException e) {
            return null;
        }
    }

    public class Request {
        @InvocableVariable(
            label='Opportunity ID'
            description='ID of the opportunity to change, as returned by Find Opportunity'
            required=true
        )
        public String opportunityId;

        @InvocableVariable(
            label='New Stage'
            description='Stage to move the opportunity to, for example Qualification or Closed Won'
            required=true
        )
        public String newStage;
    }

    public class Result {
        @InvocableVariable(
            label='Success'
            description='True only if the change was saved and the record now holds the new stage'
        )
        public Boolean success;

        @InvocableVariable(
            label='Message'
            description='What happened, including the save error text when the change was not saved'
        )
        public String message;

        @InvocableVariable(
            label='Current Stage'
            description='Stage the opportunity holds after the attempt'
        )
        public String currentStage;

        @InvocableVariable(
            label='Previous Stage'
            description='Stage the opportunity held before the attempt'
        )
        public String previousStage;
    }
}
