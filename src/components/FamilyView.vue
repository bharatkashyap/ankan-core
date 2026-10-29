<script setup lang="ts">
import { computed, ref } from "vue";
import { Plus, X } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFamilies } from "@/composables/useConvex";
import { useAuthStore } from "@/stores/auth";

const { families, isLoading, createFamily, inviteMember } = useFamilies();
const auth = useAuthStore();

const selectedFamilyId = ref<string>("");
const newFamilyName = ref("My Family");
const inviteEmail = ref("");
const creating = ref(false);
const inviting = ref(false);
const showCreateFamily = ref(false);

const selectedFamily = computed(() => {
  if (!families.value.length) return null;
  if (!selectedFamilyId.value) return families.value[0] || null;
  return families.value.find((f) => f.familyId === selectedFamilyId.value) || families.value[0] || null;
});

const create = async () => {
  if (!newFamilyName.value.trim()) return;
  creating.value = true;
  try {
    const result = await createFamily({ name: newFamilyName.value.trim() });
    selectedFamilyId.value = result.familyId;
    newFamilyName.value = "My Family";
    showCreateFamily.value = false;
  } finally {
    creating.value = false;
  }
};

const invite = async () => {
  if (!selectedFamily.value || !inviteEmail.value.trim()) return;
  inviting.value = true;
  try {
    await inviteMember({
      familyId: selectedFamily.value.familyId,
      email: inviteEmail.value.trim(),
    });
    inviteEmail.value = "";
  } finally {
    inviting.value = false;
  }
};
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <div class="flex items-center justify-between gap-3">
      <h1 class="text-xl font-semibold">Family</h1>
      <div class="flex items-center gap-2">
        <Select
          v-if="families.length > 1"
          :model-value="selectedFamilyId || selectedFamily?.familyId"
          @update:model-value="(v) => (selectedFamilyId = String(v))"
        >
          <SelectTrigger class="w-[220px]">
            <SelectValue placeholder="Choose family" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="f in families"
              :key="f.familyId"
              :value="String(f.familyId)"
            >
              {{ f.name }}
            </SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          @click="showCreateFamily = !showCreateFamily"
        >
          <Plus class="h-3.5 w-3.5" />
          New family
        </Button>
      </div>
    </div>

    <div v-if="isLoading" class="text-sm text-muted-foreground">Loading family...</div>

    <div v-if="!isLoading && showCreateFamily" class="border rounded-lg p-4 space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-sm font-medium">Create family</p>
        <Button variant="ghost" size="icon-sm" @click="showCreateFamily = false">
          <X class="h-4 w-4" />
        </Button>
      </div>
      <div class="flex gap-2">
        <Input
          v-model="newFamilyName"
          type="text"
          placeholder="Family name"
        />
        <Button
          :disabled="creating || !newFamilyName.trim()"
          @click="create"
        >
          Create
        </Button>
      </div>
    </div>

    <div v-if="!isLoading && !families.length" class="border rounded-lg p-4">
      <p class="text-sm text-muted-foreground">You are not in a family yet.</p>
    </div>

    <div v-else-if="selectedFamily" class="space-y-4">
      <div class="border rounded-lg p-4 space-y-3">
        <div class="flex items-center justify-between">
          <p class="text-sm text-muted-foreground">
            Family:
            <span class="text-foreground font-medium">{{ selectedFamily.name }}</span>
          </p>
          <span class="text-xs text-muted-foreground capitalize">{{ selectedFamily.yourRole }}</span>
        </div>
        <p class="text-xs text-muted-foreground">Invite a member by email</p>
        <form class="flex gap-2" @submit.prevent="invite">
          <Input
            v-model="inviteEmail"
            type="email"
            placeholder="name@example.com"
            class="flex-1"
          />
          <Button
            type="submit"
            :disabled="inviting"
          >
            Invite
          </Button>
        </form>
      </div>

      <div class="border rounded-lg p-4">
        <p class="text-sm font-medium mb-3">Members</p>
        <div class="space-y-2 text-sm">
          <div
            v-for="m in selectedFamily.members"
            :key="m.userId"
            class="flex items-center justify-between"
          >
            <div class="min-w-0">
              <div class="truncate">
                <span>{{ m.email || m.name }}</span>
                <span v-if="m.userId === auth.userId" class="text-xs text-muted-foreground ml-1">(You)</span>
                <span class="text-muted-foreground ml-1">({{ m.role }})</span>
              </div>
              <div v-if="m.email && m.name && m.name !== m.email" class="text-xs text-muted-foreground truncate">
                {{ m.name }}
              </div>
            </div>
            <span class="text-xs text-muted-foreground">{{ m.emailVerified ? 'Verified' : 'Unverified' }}</span>
          </div>
        </div>
      </div>

      <div class="border rounded-lg p-4" v-if="selectedFamily.invites.length">
        <p class="text-sm font-medium mb-3">Pending Invites</p>
        <div class="space-y-2 text-sm">
          <div v-for="i in selectedFamily.invites" :key="i.inviteId" class="flex items-center justify-between">
            <span>{{ i.email }}</span>
            <span class="text-xs text-muted-foreground">Pending</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
