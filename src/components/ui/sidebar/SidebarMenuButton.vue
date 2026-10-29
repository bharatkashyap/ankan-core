<script setup lang="ts">
import type { Component } from "vue";
import type { SidebarMenuButtonProps } from "./SidebarMenuButtonChild.vue";
import { reactiveOmit } from "@vueuse/core";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import SidebarMenuButtonChild from "./SidebarMenuButtonChild.vue";
import { useSidebar } from "./utils";

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<
    SidebarMenuButtonProps & {
      tooltip?: string | Component;
    }
  >(),
  {
    as: "button",
    variant: "default",
    size: "default",
  },
);

const { isMobile, state, setOpenMobile } = useSidebar();

const delegatedProps = reactiveOmit(props, "tooltip");

// Close mobile sidebar when button is clicked (for navigation)
const handleClick = (_event: Event) => {
  if (isMobile.value) {
    setOpenMobile(false);
  }
};
</script>

<template>
  <SidebarMenuButtonChild
    v-if="!tooltip"
    v-bind="{ ...delegatedProps, ...$attrs }"
    @click="handleClick"
  >
    <slot />
  </SidebarMenuButtonChild>

  <Tooltip v-else>
    <TooltipTrigger as-child>
      <SidebarMenuButtonChild
        v-bind="{ ...delegatedProps, ...$attrs }"
        @click="handleClick"
      >
        <slot />
      </SidebarMenuButtonChild>
    </TooltipTrigger>
    <TooltipContent
      side="right"
      align="center"
      :hidden="state !== 'collapsed' || isMobile"
    >
      <template v-if="typeof tooltip === 'string'">
        {{ tooltip }}
      </template>
      <component :is="tooltip" v-else />
    </TooltipContent>
  </Tooltip>
</template>
